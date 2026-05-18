package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ==================== AI 用量记录（V7：用量监控） ====================

// AIUsageRecord AI 单次成功调用的用量记录
//
// 由 AIService.ChatCompletion 在每次成功（HTTP 200）后异步写入，
// 用于：
//  1. 用量曲线（按 day / week / month 聚合）
//  2. 当前余量可视化（与 ai.monthly_token_budget 对比）
//  3. 故障排查（结合 ai_failover_logs 看切换前后用量趋势）
type AIUsageRecord struct {
	ID               string    `json:"id" gorm:"primaryKey;type:text"`
	Provider         string    `json:"provider" gorm:"index;type:text"`
	Model            string    `json:"model" gorm:"type:text"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	TotalTokens      int       `json:"total_tokens"`
	CostUSD          float64   `json:"cost_usd"`
	CostCNY          float64   `json:"cost_cny"`
	Scene            string    `json:"scene" gorm:"index;type:text"` // smart_search / recommend / metadata / autopilot / assistant ...
	LatencyMs        int64     `json:"latency_ms"`
	Success          bool      `json:"success"`
	CreatedAt        time.Time `json:"created_at" gorm:"index"`
}

func (r *AIUsageRecord) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now()
	}
	if r.TotalTokens == 0 {
		r.TotalTokens = r.PromptTokens + r.CompletionTokens
	}
	return nil
}

// ==================== AI 故障转移日志（V7：智能切换审计） ====================

// AIFailoverLog AI provider 切换审计日志
//
// 由 AIRouter 在以下时机写入：
//  1. 主 provider 因配额耗尽 / 持续 429 / 连续 5xx 触发切换
//  2. 用户手动 ForceSwitch / Restore
//  3. 自动恢复主 provider 成功 / 失败
type AIFailoverLog struct {
	ID           string    `json:"id" gorm:"primaryKey;type:text"`
	FromProvider string    `json:"from_provider" gorm:"type:text"`
	ToProvider   string    `json:"to_provider" gorm:"type:text"`
	Reason       string    `json:"reason" gorm:"index;type:text"` // quota_exhausted / http_429 / http_5xx / manual_switch / manual_restore / auto_recover
	Detail       string    `json:"detail" gorm:"type:text"`       // 错误体片段或操作来源
	Operator     string    `json:"operator" gorm:"type:text"`     // system / userID
	OccurredAt   time.Time `json:"occurred_at" gorm:"index"`
}

func (l *AIFailoverLog) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	if l.OccurredAt.IsZero() {
		l.OccurredAt = time.Now()
	}
	return nil
}
