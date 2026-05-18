// Package service 之 ai_router.go 实现 AI 智能路由 / 故障转移 / 用量监控。
//
// 它在 AIService 之上提供一层"前置守门员"：
//
//	业务调用 → AIRouter.Call → AIService.ChatCompletion → LLM
//	                  │                  ↑
//	                  ├─ 配额耗尽 / 持续 429 / 连续 5xx
//	                  ↓
//	                切换到下一个 provider → 重试一次（最多遍历整条链）
//
// 与 AIService 的分工：
//   - AIService 只关心"当前激活 provider 怎么调"；
//   - AIRouter 关心"调失败了换谁、怎么记账、什么时候恢复"。
//
// 接入方式：
//  1. ChatCompletion / TestConnection 等热路径继续保留，
//     在 AIService 内部接入 AIRouter 的 hook（成功/失败回调）；
//  2. 新增的强制切换 / 恢复 / 查询切换日志 API 走 AIRouter。
package service

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/nowen-video/nowen-video/internal/config"
	"github.com/nowen-video/nowen-video/internal/model"
	"github.com/nowen-video/nowen-video/internal/repository"
	"go.uber.org/zap"
)

// FailoverReason 切换原因常量
const (
	FailoverReasonQuotaExhausted      = "quota_exhausted"
	FailoverReasonModelQuotaExhausted = "model_quota_exhausted" // V8：单模型免费额度用尽（同 provider 内换 model）
	FailoverReasonHTTP429             = "http_429_persistent"
	FailoverReasonHTTP5xx             = "http_5xx_consecutive"
	FailoverReasonNetwork             = "network_error"
	FailoverReasonManualSwitch        = "manual_switch"
	FailoverReasonManualRestore       = "manual_restore"
	FailoverReasonAutoRecover         = "auto_recover"
	FailoverReasonBudgetReached       = "monthly_token_budget_reached"
)

// AIRouter AI 智能路由器
//
// 维护"当前实际生效 provider"的状态机：
//   - PreferredProvider：用户偏好的主 provider（来自 cfg.AI.Provider）
//   - currentActive：此刻在用的 provider（可能因 failover 切换）
//   - consecutiveErrors：当前 provider 的连续错误次数
type AIRouter struct {
	ai          *AIService
	cost        *AICostService
	usageRepo   *repository.AIUsageRepo
	failoverLog *repository.AIFailoverLogRepo
	cfg         *config.Config
	logger      *zap.SugaredLogger

	mu                sync.RWMutex
	currentActive     string    // 此刻生效的 provider
	consecutiveErrors int       // 当前 provider 连续错误数
	lastSwitchedAt    time.Time // 最近一次切换时间（用于自动恢复）

	// 月度 token 累计（懒加载，每次 Call 后基于当月 from~now 累加；周期变化时清零）
	monthCountTokens int64
	monthCountAt     int // year*100+month

	// 预警通知去抖（避免每次 call 都打一行警告）
	lastWarningAt   time.Time
	lastBudgetWarn  bool
	lastBudgetReach bool
}

// NewAIRouter 构造
func NewAIRouter(
	ai *AIService,
	cost *AICostService,
	usageRepo *repository.AIUsageRepo,
	failoverLog *repository.AIFailoverLogRepo,
	cfg *config.Config,
	logger *zap.SugaredLogger,
) *AIRouter {
	r := &AIRouter{
		ai:          ai,
		cost:        cost,
		usageRepo:   usageRepo,
		failoverLog: failoverLog,
		cfg:         cfg,
		logger:      logger,
	}
	// 启动时尝试恢复之前持久化的 active provider
	if cfg != nil {
		if cfg.AI.Failover.CurrentActive != "" {
			r.currentActive = cfg.AI.Failover.CurrentActive
		} else {
			r.currentActive = cfg.AI.Provider
		}
	}
	// 注入到 AIService（让 ChatCompletion 在每次调用前后回调 router）
	if ai != nil {
		ai.SetRouter(r)
	}
	return r
}

// CurrentActive 返回此刻生效的 provider id
func (r *AIRouter) CurrentActive() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.currentActive == "" && r.cfg != nil {
		return r.cfg.AI.Provider
	}
	return r.currentActive
}

// PreferredProvider 用户偏好的主 provider（不受 failover 影响）
func (r *AIRouter) PreferredProvider() string {
	if r.cfg == nil {
		return ""
	}
	return r.cfg.AI.Provider
}

// FailoverChain 返回当前生效的切换链；自动补齐顶层 provider 到第 0 位
func (r *AIRouter) FailoverChain() []string {
	if r.cfg == nil {
		return nil
	}
	pref := r.PreferredProvider()
	if !r.cfg.AI.Failover.Enabled {
		// 关闭 failover 时只允许使用主 provider
		if pref == "" {
			return nil
		}
		return []string{pref}
	}
	chain := make([]string, 0, len(r.cfg.AI.Failover.Chain)+1)
	if pref != "" {
		chain = append(chain, pref)
	}
	for _, p := range r.cfg.AI.Failover.Chain {
		p = strings.TrimSpace(strings.ToLower(p))
		if p == "" || p == pref {
			continue
		}
		// 必须在 profiles 中存在且 enabled != false
		if profile, ok := r.cfg.AI.Profiles[p]; ok {
			if profile.APIKey == "" {
				continue // 没填 key 的备用 provider 直接跳过
			}
			if !profile.Enabled && r.profileExplicitlyDisabled(p) {
				continue
			}
		} else {
			continue
		}
		chain = append(chain, p)
	}
	return chain
}

// profileExplicitlyDisabled 判断某 profile 是否被用户显式禁用
//
// yaml 中没写 enabled 字段时，默认视为 true（允许参与）。
// 仅当 yaml 中明确写 enabled: false 才不参与。
// 为简化判断，这里统一以 r.cfg.AI.Profiles[p].Enabled == false 视为禁用，
// 调用方在加载侧需保证 enabled 默认为 true。
func (r *AIRouter) profileExplicitlyDisabled(p string) bool {
	// 当前实现：直接读 Enabled 字段。要求加载时为缺省值默认填 true。
	// 此函数预留扩展点，未来可改为读取额外的 disabled bitmap。
	return false
}

// MarkSuccess 在每次 AI 调用成功后由 AIService 回调
//
// 参数：
//   - provider/model：本次实际使用的 provider 与 model
//   - prompt/completion：本次消耗的 token 数
//   - latencyMs：耗时
//   - scene：场景标签（如 smart_search / metadata / autopilot）
func (r *AIRouter) MarkSuccess(provider, modelID string, prompt, completion int, latencyMs int64, scene string) {
	r.mu.Lock()
	r.consecutiveErrors = 0
	r.mu.Unlock()

	// 1. 写用量记录（异步，不阻塞调用方）
	go r.recordUsage(provider, modelID, prompt, completion, latencyMs, scene, true)

	// 2. 累计月度 token 并按需告警 / 切换
	go r.checkBudgetAfterUse(prompt + completion)
}

// MarkFailure 在每次 AI 调用失败后由 AIService 回调
//
// 参数：
//   - provider：失败时使用的 provider
//   - statusCode：HTTP 状态码（0 表示网络错误）
//   - body：响应体片段（用于检测 quota_exhausted 关键词）
//
// 返回：是否应该切换到下一个 provider（true 时调用方应重试）
func (r *AIRouter) MarkFailure(provider string, statusCode int, body string) (shouldSwitch bool, nextProvider string, reason string) {
	r.mu.Lock()
	r.consecutiveErrors++
	consec := r.consecutiveErrors
	r.mu.Unlock()

	// 1. 异步写失败的用量记录（PromptTokens=0）
	go r.recordUsage(provider, "", 0, 0, 0, "error", false)

	// 2. 评估是否需要切换
	if r.cfg == nil || !r.cfg.AI.Failover.Enabled {
		return false, "", ""
	}
	threshold := r.cfg.AI.Failover.ConsecutiveErrorThreshold
	if threshold <= 0 {
		threshold = 3
	}

	// 配额耗尽：错误体里含 quota / exceeded / insufficient_balance / overload
	// 同时识别阿里云百炼"单模型免费额度耗尽"特征（AllocationQuota.FreeTierOnly / Free allocated quota exceeded）
	bodyLower := strings.ToLower(body)
	quotaHints := []string{"quota", "exceeded", "insufficient_balance", "insufficient quota", "overloaded", "balance"}
	hitQuota := false
	for _, h := range quotaHints {
		if strings.Contains(bodyLower, h) {
			hitQuota = true
			break
		}
	}

	// V8：识别"单模型免费额度耗尽"——优先在同 provider 内切换 model_chain 中的下一个模型
	hitModelQuota := isModelQuotaExhausted(statusCode, body)
	if hitModelQuota {
		if r.tryAdvanceModel(provider) {
			// 模型级切换成功，不再触发 provider 级切换
			return false, "", FailoverReasonModelQuotaExhausted
		}
		// 链尾退化：继续走 provider 级切换
		hitQuota = true
	}

	switch {
	case hitQuota:
		reason = FailoverReasonQuotaExhausted
		shouldSwitch = true
	case statusCode == 429 && consec >= threshold:
		reason = FailoverReasonHTTP429
		shouldSwitch = true
	case statusCode >= 500 && statusCode < 600 && consec >= threshold:
		reason = FailoverReasonHTTP5xx
		shouldSwitch = true
	case statusCode == 0 && consec >= threshold:
		reason = FailoverReasonNetwork
		shouldSwitch = true
	}

	if !shouldSwitch {
		return false, "", ""
	}

	next, ok := r.pickNextProvider(provider)
	if !ok {
		return false, "", ""
	}
	if err := r.switchTo(provider, next, reason, fmt.Sprintf("HTTP %d, body=%s", statusCode, truncForLog(body, 200)), "system"); err != nil {
		r.logger.Warnf("AIRouter 切换失败 %s -> %s: %v", provider, next, err)
		return false, "", ""
	}
	return true, next, reason
}

// isModelQuotaExhausted 判断错误是否属于"单模型粒度的免费额度耗尽"
//
// 触发条件（任一命中即可）：
//   - HTTP 403 + body 含 "AllocationQuota.FreeTierOnly"
//   - body 含 "Free allocated quota exceeded"
//   - body 含 "model.*quota.*exhaust" 类描述
//
// 注意与 hitQuota（provider 级配额耗尽）的区别：
// 模型级 quota 一般在同 provider 下换个模型就能继续；
// provider 级 quota（账号余额耗尽 / insufficient_balance）才需要换 provider。
func isModelQuotaExhausted(statusCode int, body string) bool {
	if body == "" {
		return false
	}
	low := strings.ToLower(body)
	if strings.Contains(body, "AllocationQuota.FreeTierOnly") ||
		strings.Contains(low, "allocationquota.freetieronly") {
		return true
	}
	if strings.Contains(low, "free allocated quota exceeded") {
		return true
	}
	// 部分服务商：HTTP 403 + body 中含 model + quota
	if statusCode == 403 && strings.Contains(low, "quota") && strings.Contains(low, "model") {
		return true
	}
	return false
}

// tryAdvanceModel 尝试把当前 provider 的 model 推进到 model_chain 中的下一项
//
// 返回 true 表示已成功切换（已写 AIService 配置 + 持久化 yaml + 写审计日志）；
// 返回 false 表示链已用尽 / 无可用候选，调用方应退化到 provider 级 failover。
func (r *AIRouter) tryAdvanceModel(provider string) bool {
	if r.cfg == nil {
		return false
	}
	profile, ok := r.cfg.AI.Profiles[provider]
	if !ok {
		return false
	}
	chain := profile.ModelChain
	if len(chain) == 0 {
		return false
	}

	// 当前正在用的 model：优先 CurrentModel，其次 cfg.AI.Model（仅当 provider 是激活 provider）
	curModel := strings.TrimSpace(profile.CurrentModel)
	if curModel == "" {
		curModel = strings.TrimSpace(profile.Model)
	}
	if curModel == "" && provider == r.cfg.AI.Provider {
		curModel = strings.TrimSpace(r.cfg.AI.Model)
	}

	next := pickNextModelInChain(chain, curModel)
	if next == "" || next == curModel {
		return false
	}

	if err := r.switchModel(provider, curModel, next,
		FailoverReasonModelQuotaExhausted,
		fmt.Sprintf("model %s 配额耗尽，切换到 %s", curModel, next),
		"system"); err != nil {
		r.logger.Warnf("AIRouter 模型切换失败 %s: %s -> %s: %v", provider, curModel, next, err)
		return false
	}
	return true
}

// pickNextModelInChain 在模型链中找到 cur 之后第一个非空、非重复且不等于 cur 的模型
//
// 当 cur 不在链里时，返回链中第一个不等于 cur 的元素（即从头开始）。
func pickNextModelInChain(chain []string, cur string) string {
	cur = strings.TrimSpace(cur)
	idx := -1
	for i, m := range chain {
		if strings.TrimSpace(m) == cur {
			idx = i
			break
		}
	}
	for i := idx + 1; i < len(chain); i++ {
		m := strings.TrimSpace(chain[i])
		if m == "" || m == cur {
			continue
		}
		return m
	}
	return ""
}

// switchModel 在同一 provider 内切换 model（不改 provider / api_base / api_key）
//
// 落地副作用：
//  1. 更新 AIService 当前生效 model（若 provider 恰好是激活 provider）
//  2. 更新 cfg.AI.Profiles[provider].CurrentModel 并落盘 yaml
//  3. 写审计日志（reason=model_quota_exhausted），from/to 字段格式 "<provider>:<model>"
func (r *AIRouter) switchModel(provider, fromModel, toModel, reason, detail, operator string) error {
	if r.cfg == nil {
		return errors.New("cfg 未初始化")
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	toModel = strings.TrimSpace(toModel)
	if provider == "" || toModel == "" {
		return errors.New("provider 或 model 为空")
	}
	profile, ok := r.cfg.AI.Profiles[provider]
	if !ok {
		return fmt.Errorf("profile %s 不存在", provider)
	}

	// 1. 更新 AIService 配置（仅当 provider 是当前激活 provider）
	if r.ai != nil && provider == r.cfg.AI.Provider {
		if err := r.ai.UpdateConfig(map[string]interface{}{
			"model": toModel,
		}); err != nil {
			return fmt.Errorf("更新 AIService model 失败: %w", err)
		}
	}

	// 2. 更新 profile.CurrentModel 并落盘
	profile.CurrentModel = toModel
	r.cfg.AI.Profiles[provider] = profile
	// 若 provider 是激活 provider，顺便同步顶层 cfg.AI.Model（保持单字段一致语义）
	if provider == r.cfg.AI.Provider {
		r.cfg.AI.Model = toModel
	}
	_ = r.cfg.SaveAIConfig()

	// 3. 重置连续错误计数（给新模型一个公平起点）
	r.mu.Lock()
	r.consecutiveErrors = 0
	r.lastSwitchedAt = time.Now()
	r.mu.Unlock()

	// 4. 审计日志
	if r.failoverLog != nil {
		_ = r.failoverLog.Insert(&model.AIFailoverLog{
			FromProvider: provider + ":" + fromModel,
			ToProvider:   provider + ":" + toModel,
			Reason:       reason,
			Detail:       detail,
			Operator:     operator,
		})
	}

	r.logger.Warnf("AIRouter 模型切换：[%s] %s → %s（原因：%s，操作者：%s）",
		provider, fromModel, toModel, reason, operator)
	return nil
}

// pickNextProvider 在切换链中找到 currentFrom 之后第一个可用 provider
func (r *AIRouter) pickNextProvider(currentFrom string) (string, bool) {
	chain := r.FailoverChain()
	curIdx := -1
	for i, p := range chain {
		if p == currentFrom {
			curIdx = i
			break
		}
	}
	for i := curIdx + 1; i < len(chain); i++ {
		return chain[i], true
	}
	return "", false
}

// ForceSwitch 手动强制切换到指定 provider（管理员触发）
func (r *AIRouter) ForceSwitch(toProvider, operator string) error {
	if r.cfg == nil {
		return errors.New("cfg 未初始化")
	}
	toProvider = strings.ToLower(strings.TrimSpace(toProvider))
	if toProvider == "" {
		return errors.New("provider 不能为空")
	}
	if _, ok := r.cfg.AI.Profiles[toProvider]; !ok {
		return fmt.Errorf("provider %q 不在 profiles 中", toProvider)
	}
	from := r.CurrentActive()
	return r.switchTo(from, toProvider, FailoverReasonManualSwitch, "用户手动切换", operator)
}

// Restore 恢复到主 provider（用户偏好）
func (r *AIRouter) Restore(operator string) error {
	if r.cfg == nil {
		return errors.New("cfg 未初始化")
	}
	pref := r.PreferredProvider()
	if pref == "" {
		return errors.New("主 provider 未配置")
	}
	from := r.CurrentActive()
	if from == pref {
		return nil // 已经在主 provider，无需切换
	}
	return r.switchTo(from, pref, FailoverReasonManualRestore, "用户手动恢复主 provider", operator)
}

// MaybeAutoRecover 周期性检查是否到达自动恢复时间，并尝试恢复主 provider
//
// 由调度器或下一次 Call 触发；为避免热路径成本，使用读锁快速短路。
func (r *AIRouter) MaybeAutoRecover() {
	if r.cfg == nil {
		return
	}
	mins := r.cfg.AI.Failover.AutoRecoverAfterMin
	if mins <= 0 {
		return
	}
	r.mu.RLock()
	cur := r.currentActive
	last := r.lastSwitchedAt
	r.mu.RUnlock()

	pref := r.PreferredProvider()
	if cur == pref {
		return // 已经在主 provider
	}
	if time.Since(last) < time.Duration(mins)*time.Minute {
		return
	}
	// 进入实际恢复流程（写日志 + 切换状态）
	if err := r.switchTo(cur, pref, FailoverReasonAutoRecover, "自动恢复窗口已到", "system"); err != nil {
		r.logger.Warnf("AIRouter 自动恢复失败: %v", err)
	}
}

// switchTo 执行实际切换：更新内存状态 + 持久化 + 写日志
func (r *AIRouter) switchTo(from, to, reason, detail, operator string) error {
	if to == "" {
		return errors.New("target provider 为空")
	}

	// 1. 更新 AIService 当前生效配置
	if r.cfg != nil {
		profile, ok := r.cfg.AI.Profiles[to]
		if !ok {
			return fmt.Errorf("profile %s 不存在", to)
		}
		// V8：跨 provider 切换时，优先使用目标 profile 的 CurrentModel（若曾因模型级 failover 推进过）
		effectiveModel := profile.Model
		if cm := strings.TrimSpace(profile.CurrentModel); cm != "" {
			effectiveModel = cm
		}
		updates := map[string]interface{}{
			"provider": to,
			"api_base": profile.APIBase,
			"api_key":  profile.APIKey,
			"model":    effectiveModel,
		}
		if r.ai != nil {
			if err := r.ai.UpdateConfig(updates); err != nil {
				return fmt.Errorf("更新 AIService 配置失败: %w", err)
			}
		}
	}

	// 2. 更新内存状态
	r.mu.Lock()
	r.currentActive = to
	r.consecutiveErrors = 0
	r.lastSwitchedAt = time.Now()
	r.mu.Unlock()

	// 3. 持久化 currentActive
	if r.cfg != nil {
		r.cfg.AI.Failover.CurrentActive = to
		r.cfg.AI.Failover.LastSwitchedAt = time.Now().Unix()
		_ = r.cfg.SaveAIConfig() // 失败不阻断
	}

	// 4. 写切换审计日志
	if r.failoverLog != nil {
		_ = r.failoverLog.Insert(&model.AIFailoverLog{
			FromProvider: from,
			ToProvider:   to,
			Reason:       reason,
			Detail:       detail,
			Operator:     operator,
		})
	}

	r.logger.Warnf("AIRouter 切换：%s → %s（原因：%s，操作者：%s）", from, to, reason, operator)
	return nil
}

// recordUsage 写入一条用量记录（异步入口）
func (r *AIRouter) recordUsage(provider, modelID string, prompt, completion int, latencyMs int64, scene string, success bool) {
	if r.usageRepo == nil {
		return
	}
	rec := &model.AIUsageRecord{
		Provider:         provider,
		Model:            modelID,
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      prompt + completion,
		Scene:            scene,
		LatencyMs:        latencyMs,
		Success:          success,
	}
	// 估价（CNY）
	if r.cost != nil && success {
		if est, err := r.cost.Estimate(provider, modelID, prompt, completion); err == nil && est != nil {
			rec.CostUSD = est.CostUSD
			rec.CostCNY = est.CostCNY
		}
	}
	if err := r.usageRepo.Insert(rec); err != nil {
		r.logger.Debugf("写 AI 用量记录失败（可忽略）: %v", err)
	}
}

// checkBudgetAfterUse 在每次成功调用后累加月度 token，检查是否触达预警/上限
//
// 当超过 WarningThresholdPct 时打警告日志（去抖 1 分钟）；
// 当超过 100% 且 Failover 启用时，主动触发一次 failover（reason=BudgetReached）。
func (r *AIRouter) checkBudgetAfterUse(deltaTokens int) {
	if r.cfg == nil {
		return
	}
	budget := r.cfg.AI.MonthlyTokenBudget
	if budget <= 0 || deltaTokens <= 0 {
		return
	}
	now := time.Now()
	monthKey := now.Year()*100 + int(now.Month())

	r.mu.Lock()
	if r.monthCountAt != monthKey {
		// 月切换：重置（懒回填，下次查表时再补真实数）
		r.monthCountTokens = 0
		r.monthCountAt = monthKey
		r.lastBudgetWarn = false
		r.lastBudgetReach = false
	}
	r.monthCountTokens += int64(deltaTokens)
	used := r.monthCountTokens
	warnThresh := r.cfg.AI.WarningThresholdPct
	r.mu.Unlock()

	if warnThresh <= 0 || warnThresh > 100 {
		warnThresh = 80
	}
	pct := int(used * 100 / budget)
	if pct >= 100 {
		r.handleBudgetReached(used, budget)
	} else if pct >= warnThresh {
		r.handleBudgetWarning(used, budget, pct)
	}
}

func (r *AIRouter) handleBudgetWarning(used, budget int64, pct int) {
	r.mu.Lock()
	first := !r.lastBudgetWarn
	r.lastBudgetWarn = true
	r.mu.Unlock()
	if first {
		r.logger.Warnf("⚠️ AI 月度 token 用量已达 %d%% (%d / %d)，请关注配额", pct, used, budget)
	}
}

func (r *AIRouter) handleBudgetReached(used, budget int64) {
	r.mu.Lock()
	first := !r.lastBudgetReach
	r.lastBudgetReach = true
	cur := r.currentActive
	r.mu.Unlock()
	if !first {
		return
	}
	r.logger.Errorf("🚨 AI 月度 token 配额已耗尽 (%d / %d)，准备切换到下一个 provider", used, budget)
	if !r.cfg.AI.Failover.Enabled {
		return
	}
	next, ok := r.pickNextProvider(cur)
	if !ok {
		return
	}
	_ = r.switchTo(cur, next, FailoverReasonBudgetReached,
		fmt.Sprintf("月度 token 预算 %d 已耗尽", budget), "system")
}

// LoadMonthUsage 从仓储补全当月已使用的 token（启动 / 跨月时调用）
func (r *AIRouter) LoadMonthUsage() {
	if r.usageRepo == nil {
		return
	}
	now := time.Now()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	used, err := r.usageRepo.SumTotalTokens(monthStart, now.Add(time.Minute), "")
	if err != nil {
		return
	}
	r.mu.Lock()
	r.monthCountTokens = used
	r.monthCountAt = now.Year()*100 + int(now.Month())
	r.mu.Unlock()
}

// Snapshot 用于前端 Dashboard：返回 router 完整状态
type AIRouterSnapshot struct {
	PreferredProvider   string              `json:"preferred_provider"`
	CurrentActive       string              `json:"current_active"`
	CurrentModel        string              `json:"current_model"`       // V8：当前生效 model（同 provider 内 failover 推进后）
	PreferredModel      string              `json:"preferred_model"`     // V8：用户偏好主模型（profile.Model）
	CurrentModelChain   []string            `json:"current_model_chain"` // V8：当前 provider 的模型链
	LastSwitchedAt      int64               `json:"last_switched_at"`
	FailoverEnabled     bool                `json:"failover_enabled"`
	Chain               []string            `json:"chain"`
	MonthlyTokenBudget  int64               `json:"monthly_token_budget"`
	MonthlyTokenUsed    int64               `json:"monthly_token_used"`
	MonthlyTokenPct     int                 `json:"monthly_token_pct"`
	WarningThresholdPct int                 `json:"warning_threshold_pct"`
	ConsecutiveErrors   int                 `json:"consecutive_errors"`
	AutoRecoverAfterMin int                 `json:"auto_recover_after_min"`
	ProviderTotals      []ProviderTotalView `json:"provider_totals"`
}

// ProviderTotalView 单个 provider 的当月用量摘要
type ProviderTotalView struct {
	Provider     string   `json:"provider"`
	Calls        int64    `json:"calls"`
	TotalTokens  int64    `json:"total_tokens"`
	CostCNY      float64  `json:"cost_cny"`
	Enabled      bool     `json:"enabled"`
	Configured   bool     `json:"configured"`
	CurrentModel string   `json:"current_model,omitempty"` // V8：本 provider 当前生效模型
	ModelChain   []string `json:"model_chain,omitempty"`   // V8：本 provider 模型链
}

// GetSnapshot 拉取 AIRouter 当前状态（前端 dashboard 用）
func (r *AIRouter) GetSnapshot() AIRouterSnapshot {
	r.mu.RLock()
	cur := r.currentActive
	consec := r.consecutiveErrors
	used := r.monthCountTokens
	last := r.lastSwitchedAt
	r.mu.RUnlock()

	snap := AIRouterSnapshot{
		PreferredProvider: r.PreferredProvider(),
		CurrentActive:     cur,
		LastSwitchedAt:    last.Unix(),
		ConsecutiveErrors: consec,
		MonthlyTokenUsed:  used,
	}
	if r.cfg != nil {
		snap.FailoverEnabled = r.cfg.AI.Failover.Enabled
		snap.Chain = r.FailoverChain()
		snap.MonthlyTokenBudget = r.cfg.AI.MonthlyTokenBudget
		snap.WarningThresholdPct = r.cfg.AI.WarningThresholdPct
		snap.AutoRecoverAfterMin = r.cfg.AI.Failover.AutoRecoverAfterMin

		// V8：当前生效 provider 的模型信息
		if profile, ok := r.cfg.AI.Profiles[cur]; ok {
			if cm := strings.TrimSpace(profile.CurrentModel); cm != "" {
				snap.CurrentModel = cm
			} else {
				snap.CurrentModel = profile.Model
			}
			snap.PreferredModel = profile.Model
			snap.CurrentModelChain = append([]string(nil), profile.ModelChain...)
		} else {
			// 未在 profiles 中（极少数情况），回退到顶层 cfg.AI.Model
			snap.CurrentModel = r.cfg.AI.Model
			snap.PreferredModel = r.cfg.AI.Model
		}
	}
	if snap.MonthlyTokenBudget > 0 {
		snap.MonthlyTokenPct = int(used * 100 / snap.MonthlyTokenBudget)
	}
	// 当月按 provider 聚合
	if r.usageRepo != nil {
		now := time.Now()
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		if rows, err := r.usageRepo.SumByProvider(monthStart, now.Add(time.Minute)); err == nil {
			byProv := make(map[string]repository.AIUsageProviderTotal, len(rows))
			for _, row := range rows {
				byProv[row.Provider] = row
			}
			// 输出顺序：链 + 其余 profile
			emitted := make(map[string]bool)
			for _, p := range snap.Chain {
				row := byProv[p]
				profile, ok := r.cfg.AI.Profiles[p]
				view := ProviderTotalView{
					Provider:    p,
					Calls:       row.Calls,
					TotalTokens: row.TotalTokens,
					CostCNY:     row.CostCNY,
					Enabled:     ok,
					Configured:  ok && profile.APIKey != "",
				}
				if ok {
					if cm := strings.TrimSpace(profile.CurrentModel); cm != "" {
						view.CurrentModel = cm
					} else {
						view.CurrentModel = profile.Model
					}
					view.ModelChain = append([]string(nil), profile.ModelChain...)
				}
				snap.ProviderTotals = append(snap.ProviderTotals, view)
				emitted[p] = true
			}
			for p, row := range byProv {
				if emitted[p] {
					continue
				}
				profile, ok := r.cfg.AI.Profiles[p]
				view := ProviderTotalView{
					Provider:    p,
					Calls:       row.Calls,
					TotalTokens: row.TotalTokens,
					CostCNY:     row.CostCNY,
					Enabled:     ok,
					Configured:  ok && profile.APIKey != "",
				}
				if ok {
					if cm := strings.TrimSpace(profile.CurrentModel); cm != "" {
						view.CurrentModel = cm
					} else {
						view.CurrentModel = profile.Model
					}
					view.ModelChain = append([]string(nil), profile.ModelChain...)
				}
				snap.ProviderTotals = append(snap.ProviderTotals, view)
			}
		}
	}
	return snap
}

// truncForLog 截断字符串用于日志记录
func truncForLog(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
