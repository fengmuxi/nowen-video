package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/repository"
	"github.com/nowen-video/nowen-video/internal/service"
	"go.uber.org/zap"
)

// AIHandler AI 功能处理器
type AIHandler struct {
	aiService   *service.AIService
	router      *service.AIRouter
	usageRepo   *repository.AIUsageRepo
	failoverLog *repository.AIFailoverLogRepo
	cfg         *config.Config
	logger      *zap.SugaredLogger
}

// SmartSearch AI 智能搜索（解析自然语言查询）
func (h *AIHandler) SmartSearch(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "搜索关键词不能为空"})
		return
	}

	intent, err := h.aiService.ParseSearchIntent(query)
	if err != nil {
		h.logger.Warnf("AI 智能搜索失败: %v", err)
		c.JSON(http.StatusOK, gin.H{
			"data": service.SearchIntent{
				Query:  query,
				Parsed: false,
			},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": intent})
}

// GetAIStatus 获取 AI 服务状态（管理员）
func (h *AIHandler) GetAIStatus(c *gin.Context) {
	status := h.aiService.GetStatus()
	c.JSON(http.StatusOK, gin.H{"data": status})
}

// UpdateAIConfig 更新 AI 配置（管理员）
func (h *AIHandler) UpdateAIConfig(c *gin.Context) {
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	if err := h.aiService.UpdateConfig(updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	status := h.aiService.GetStatus()
	c.JSON(http.StatusOK, gin.H{"message": "AI 配置已更新", "data": status})
}

// TestAIConnection 测试 AI API 连接（管理员）
func (h *AIHandler) TestAIConnection(c *gin.Context) {
	result, err := h.aiService.TestConnection()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": result})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// ClearAICache 清空 AI 缓存（管理员）
func (h *AIHandler) ClearAICache(c *gin.Context) {
	count := h.aiService.ClearCache()
	c.JSON(http.StatusOK, gin.H{
		"message": "AI 缓存已清空",
		"data":    gin.H{"cleared": count},
	})
}

// GetAICacheStats 获取 AI 缓存统计（管理员）
func (h *AIHandler) GetAICacheStats(c *gin.Context) {
	stats := h.aiService.GetCacheStats()
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

// GetAIErrorLogs 获取 AI 错误日志（管理员）
func (h *AIHandler) GetAIErrorLogs(c *gin.Context) {
	logs := h.aiService.GetErrorLogs()
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// TestSmartSearch 测试智能搜索功能（管理员）
func (h *AIHandler) TestSmartSearch(c *gin.Context) {
	var req struct {
		Query string `json:"query" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 query 参数"})
		return
	}

	result, err := h.aiService.TestSmartSearch(req.Query)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// EnableAutoPilot 一键启用 AI 全自动托管模式（管理员）
//
// 接受可选的 provider 预设与 api_key，会在一次调用中：
//  1. 强制开启 ai.enabled / ai.auto_pilot
//  2. 强制启用三个子功能开关（智能搜索、推荐理由、元数据增强）
//  3. 拒绝本地 AI（block_local_ai=true）
//  4. 按预设 provider 自动填好 api_base / model（用户只需提供 api_key）
//
// 请求体示例：
//
//	{ "provider": "deepseek", "api_key": "sk-xxxxxx" }
func (h *AIHandler) EnableAutoPilot(c *gin.Context) {
	var req struct {
		Provider string `json:"provider"`
		APIKey   string `json:"api_key"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		// 允许空 body：表示在已有 provider/api_key 基础上仅打开 AutoPilot 开关
		req = struct {
			Provider string `json:"provider"`
			APIKey   string `json:"api_key"`
		}{}
	}

	updates := map[string]interface{}{
		"enabled":                 true,
		"auto_pilot":              true,
		"block_local_ai":          true,
		"enable_smart_search":     true,
		"enable_recommend_reason": true,
		"enable_metadata_enhance": true,
	}

	// V7：provider 预设走统一表（config/ai_presets.go）
	if req.Provider != "" {
		updates["provider"] = req.Provider
		if p, ok := config.FindAIProviderPreset(req.Provider); ok {
			updates["api_base"] = p.APIBase
			updates["model"] = p.DefaultModel
		}
	}
	if req.APIKey != "" {
		updates["api_key"] = req.APIKey
	}

	if err := h.aiService.UpdateConfig(updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	status := h.aiService.GetStatus()
	c.JSON(http.StatusOK, gin.H{
		"message": "AI 全自动托管模式已开启",
		"data":    status,
	})
}

// TestRecommendReason 测试推荐理由生成（管理员）
func (h *AIHandler) TestRecommendReason(c *gin.Context) {
	var req struct {
		Title  string `json:"title" binding:"required"`
		Genres string `json:"genres"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 title 参数"})
		return
	}

	result, err := h.aiService.TestRecommendReason(req.Title, req.Genres)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": false, "error": err.Error()}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// ==================== V7：智能调度器 / 用量监控 / 故障转移 ====================

// ListProviderPresets 返回所有 AI 提供商的开箱即用预设（公开 GET）
//
// 用于前端"一键配置"按钮：列出 qwen / deepseek / openai / zhipu / claude / ollama
// 等候选 provider，含默认 api_base、推荐 model、备注说明。
func (h *AIHandler) ListProviderPresets(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": config.ListAIProviderPresets()})
}

// QuickConfigQwen 一键配置通义千问（管理员）
//
// 请求体：{ "api_key": "sk-..." }
//
// 行为：
//  1. 读取 qwen 预设（api_base + 推荐 model）
//  2. 写入 ai.profiles.qwen = { api_base, api_key, model }
//  3. 切换 ai.provider = qwen
//  4. 自动开启 ai.enabled
//  5. 触发一次连接验证，返回结果
func (h *AIHandler) QuickConfigQwen(c *gin.Context) {
	var req struct {
		APIKey string `json:"api_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 api_key 参数"})
		return
	}
	preset := config.QwenPreset()
	// V8：默认填充模型链（同 provider 内 failover 顺序）。AvailableModels 已按推荐度倒序排列。
	// 用户后续可在 UI 上自由增删 / 排序。
	defaultChain := append([]string{}, preset.AvailableModels...)
	updates := map[string]interface{}{
		"enabled":  true,
		"provider": preset.Provider,
		"api_base": preset.APIBase,
		"api_key":  req.APIKey,
		"model":    preset.DefaultModel,
		"profiles": map[string]interface{}{
			preset.Provider: map[string]interface{}{
				"api_base":    preset.APIBase,
				"api_key":     req.APIKey,
				"model":       preset.DefaultModel,
				"enabled":     true,
				"model_chain": defaultChain,
			},
		},
	}
	if err := h.aiService.UpdateConfig(updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 验证连接
	test, _ := h.aiService.TestConnection()
	c.JSON(http.StatusOK, gin.H{
		"message": "通义千问已配置完成",
		"data": gin.H{
			"status": h.aiService.GetStatus(),
			"test":   test,
		},
	})
}

// GetRouterSnapshot 获取 AIRouter 当前状态（管理员）
//
// 返回当前生效 provider、月度用量、切换链、消耗百分比等，用于前端 dashboard。
func (h *AIHandler) GetRouterSnapshot(c *gin.Context) {
	if h.router == nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"failover_enabled":   false,
			"current_active":     "",
			"preferred_provider": "",
		}})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.router.GetSnapshot()})
}

// ForceSwitchProvider 强制切换到指定 provider（管理员）
//
// 请求体：{ "provider": "deepseek" }
func (h *AIHandler) ForceSwitchProvider(c *gin.Context) {
	if h.router == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
		return
	}
	var req struct {
		Provider string `json:"provider" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请提供 provider 参数"})
		return
	}
	operator := getUsernameFromContext(c)
	if err := h.router.ForceSwitch(req.Provider, operator); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已切换到 " + req.Provider,
		"data":    h.router.GetSnapshot(),
	})
}

// RestoreProvider 手动恢复主 provider（管理员）
func (h *AIHandler) RestoreProvider(c *gin.Context) {
	if h.router == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AIRouter 未启用"})
		return
	}
	operator := getUsernameFromContext(c)
	if err := h.router.Restore(operator); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "已恢复到主 provider",
		"data":    h.router.GetSnapshot(),
	})
}

// ListFailoverLogs 列出最近的切换审计日志（管理员）
//
// Query: ?limit=100
func (h *AIHandler) ListFailoverLogs(c *gin.Context) {
	if h.failoverLog == nil {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
		return
	}
	limit := 100
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	logs, err := h.failoverLog.List(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": logs})
}

// GetUsageBuckets 用量曲线（管理员）
//
// Query:
//   - range: day | week | month  (默认 month)
//   - provider: 可选，按 provider 过滤
func (h *AIHandler) GetUsageBuckets(c *gin.Context) {
	if h.usageRepo == nil {
		c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
		return
	}
	rng := strings.ToLower(c.DefaultQuery("range", "month"))
	provider := c.Query("provider")
	now := time.Now()
	var from time.Time
	switch rng {
	case "day":
		from = now.AddDate(0, 0, -1)
	case "week":
		from = now.AddDate(0, 0, -7)
	case "month":
		from = now.AddDate(0, -1, 0)
	case "year":
		from = now.AddDate(-1, 0, 0)
	default:
		from = now.AddDate(0, -1, 0)
	}
	buckets, err := h.usageRepo.AggregateByDay(from, now.Add(time.Minute), provider)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	totals, _ := h.usageRepo.SumByProvider(from, now.Add(time.Minute))
	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"buckets":         buckets,
			"provider_totals": totals,
			"range":           rng,
			"from":            from,
			"to":              now,
		},
	})
}

// getUsernameFromContext 尝试从 gin context 中读取登录用户名，否则返回 "system"
func getUsernameFromContext(c *gin.Context) string {
	if v, ok := c.Get("username"); ok {
		if s, ok2 := v.(string); ok2 && s != "" {
			return s
		}
	}
	if v, ok := c.Get("user_id"); ok {
		if s, ok2 := v.(string); ok2 && s != "" {
			return s
		}
	}
	return "system"
}
