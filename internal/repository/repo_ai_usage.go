package repository

import (
	"time"

	"github.com/nowen-video/nowen-video/internal/model"
	"gorm.io/gorm"
)

// ==================== AIUsageRepo ====================
//
// 提供 AIUsageRecord 的写入、聚合查询与裁剪。
// 写入路径在调用链热路径上，故 Insert 设计为非阻塞失败（错误仅返回，不抛异常）。

// AIUsageRepo AI 用量记录仓储
type AIUsageRepo struct {
	db *gorm.DB
}

// NewAIUsageRepo 构造
func NewAIUsageRepo(db *gorm.DB) *AIUsageRepo {
	return &AIUsageRepo{db: db}
}

// Insert 插入一条用量记录
func (r *AIUsageRepo) Insert(rec *model.AIUsageRecord) error {
	return r.db.Create(rec).Error
}

// AIUsageBucket 按时间分桶的聚合结果
type AIUsageBucket struct {
	Bucket           string  `json:"bucket"` // YYYY-MM-DD 或 YYYY-MM 等
	Calls            int64   `json:"calls"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	CostCNY          float64 `json:"cost_cny"`
}

// AggregateByDay 按天聚合 [from, to) 内的用量
func (r *AIUsageRepo) AggregateByDay(from, to time.Time, provider string) ([]AIUsageBucket, error) {
	var buckets []AIUsageBucket
	q := r.db.Model(&model.AIUsageRecord{}).
		Select(`strftime('%Y-%m-%d', created_at) AS bucket,
			COUNT(*) AS calls,
			COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
			COALESCE(SUM(completion_tokens),0) AS completion_tokens,
			COALESCE(SUM(total_tokens),0) AS total_tokens,
			COALESCE(SUM(cost_cny),0) AS cost_cny`).
		Where("created_at >= ? AND created_at < ?", from, to).
		Group("bucket").
		Order("bucket ASC")
	if provider != "" {
		q = q.Where("provider = ?", provider)
	}
	if err := q.Scan(&buckets).Error; err != nil {
		return nil, err
	}
	return buckets, nil
}

// AggregateByMonth 按月聚合 [from, to) 内的用量
func (r *AIUsageRepo) AggregateByMonth(from, to time.Time, provider string) ([]AIUsageBucket, error) {
	var buckets []AIUsageBucket
	q := r.db.Model(&model.AIUsageRecord{}).
		Select(`strftime('%Y-%m', created_at) AS bucket,
			COUNT(*) AS calls,
			COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
			COALESCE(SUM(completion_tokens),0) AS completion_tokens,
			COALESCE(SUM(total_tokens),0) AS total_tokens,
			COALESCE(SUM(cost_cny),0) AS cost_cny`).
		Where("created_at >= ? AND created_at < ?", from, to).
		Group("bucket").
		Order("bucket ASC")
	if provider != "" {
		q = q.Where("provider = ?", provider)
	}
	if err := q.Scan(&buckets).Error; err != nil {
		return nil, err
	}
	return buckets, nil
}

// AIUsageProviderTotal 按 provider 聚合的总量
type AIUsageProviderTotal struct {
	Provider    string  `json:"provider"`
	Calls       int64   `json:"calls"`
	TotalTokens int64   `json:"total_tokens"`
	CostCNY     float64 `json:"cost_cny"`
}

// SumByProvider 在 [from, to) 内按 provider 聚合
func (r *AIUsageRepo) SumByProvider(from, to time.Time) ([]AIUsageProviderTotal, error) {
	var rows []AIUsageProviderTotal
	err := r.db.Model(&model.AIUsageRecord{}).
		Select(`provider,
			COUNT(*) AS calls,
			COALESCE(SUM(total_tokens),0) AS total_tokens,
			COALESCE(SUM(cost_cny),0) AS cost_cny`).
		Where("created_at >= ? AND created_at < ?", from, to).
		Group("provider").
		Order("total_tokens DESC").
		Scan(&rows).Error
	return rows, err
}

// SumTotalTokens 返回 [from, to) 范围内的总 token 数（可按 provider 过滤）
func (r *AIUsageRepo) SumTotalTokens(from, to time.Time, provider string) (int64, error) {
	q := r.db.Model(&model.AIUsageRecord{}).
		Where("created_at >= ? AND created_at < ?", from, to)
	if provider != "" {
		q = q.Where("provider = ?", provider)
	}
	var total *int64
	if err := q.Select("COALESCE(SUM(total_tokens),0)").Scan(&total).Error; err != nil {
		return 0, err
	}
	if total == nil {
		return 0, nil
	}
	return *total, nil
}

// CleanOlderThan 清理 cutoff 之前的记录（避免无限增长）
func (r *AIUsageRepo) CleanOlderThan(cutoff time.Time) (int64, error) {
	res := r.db.Where("created_at < ?", cutoff).Delete(&model.AIUsageRecord{})
	return res.RowsAffected, res.Error
}

// ==================== AIFailoverLogRepo ====================

// AIFailoverLogRepo AI 故障转移日志仓储
type AIFailoverLogRepo struct {
	db *gorm.DB
}

// NewAIFailoverLogRepo 构造
func NewAIFailoverLogRepo(db *gorm.DB) *AIFailoverLogRepo {
	return &AIFailoverLogRepo{db: db}
}

// Insert 写入一条切换日志
func (r *AIFailoverLogRepo) Insert(log *model.AIFailoverLog) error {
	return r.db.Create(log).Error
}

// List 倒序返回最近的切换日志
func (r *AIFailoverLogRepo) List(limit int) ([]model.AIFailoverLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var logs []model.AIFailoverLog
	err := r.db.Order("occurred_at DESC").Limit(limit).Find(&logs).Error
	return logs, err
}

// CleanOlderThan 清理 cutoff 之前的切换日志
func (r *AIFailoverLogRepo) CleanOlderThan(cutoff time.Time) (int64, error) {
	res := r.db.Where("occurred_at < ?", cutoff).Delete(&model.AIFailoverLog{})
	return res.RowsAffected, res.Error
}
