// Package config 之 ai_presets.go 提供 LLM 服务商的"开箱即用"预设元信息。
//
// 用途：
//
//  1. 前端"一键配置"按钮：用户选择某 provider 后，直接拿到默认 api_base / 推荐模型；
//  2. 后端 EnableAutoPilot / 切换链路：缺省值的统一来源；
//  3. AIRouter 的 Failover：当某个 provider 在用户档案里没显式配 api_base 时，按预设回退。
//
// 注意：定价信息保留在 service/ai_models.go 的 builtinAIModelCatalog 中，
// 此处仅维护"默认地址 + 默认模型 + 元数据"，避免重复维护两份价格表。
package config

import "strings"

// AIProviderPreset LLM 提供商的开箱即用预设
type AIProviderPreset struct {
	// Provider 在 cfg.AI.Provider 中使用的标识符（小写）
	Provider string `json:"provider"`
	// Label UI 展示名（带中文）
	Label string `json:"label"`
	// APIBase OpenAI 兼容协议默认地址
	APIBase string `json:"api_base"`
	// DefaultModel 推荐入门模型
	DefaultModel string `json:"default_model"`
	// AvailableModels 该 provider 下用户可选的模型 ID 列表（按推荐度倒序）
	AvailableModels []string `json:"available_models"`
	// Description UI 旁注（中文）
	Description string `json:"description"`
	// Recommended 是否在 UI 中标"推荐"
	Recommended bool `json:"recommended"`
}

// builtinAIPresets 内置主流 LLM 提供商预设
//
// ⚠️ 调整此处时请同步检查：
//   - service/ai_models.go 的 builtinAIModelCatalog（定价与上下文窗口）
//   - handler/ai.go 的 EnableAutoPilot 老逻辑（已迁移到本表，保留兼容）
var builtinAIPresets = []AIProviderPreset{
	{
		Provider:     "qwen",
		Label:        "通义千问（阿里云百炼）",
		APIBase:      "https://dashscope.aliyuncs.com/compatible-mode/v1",
		DefaultModel: "qwen-flash-2025-07-28",
		AvailableModels: []string{
			"qwen-flash-2025-07-28",
			"qwen-plus",
			"qwen-turbo",
			"qwen-max",
			"qwen-max-longcontext",
		},
		Description: "阿里云通义千问，OpenAI 兼容，国内访问稳定。需在阿里云百炼控制台开通 DashScope。",
		Recommended: true,
	},
	{
		Provider:     "deepseek",
		Label:        "DeepSeek（深度求索）",
		APIBase:      "https://api.deepseek.com/v1",
		DefaultModel: "deepseek-chat",
		AvailableModels: []string{
			"deepseek-chat",
			"deepseek-reasoner",
		},
		Description: "性价比之王，适合大批量调用；上下文 64K，国内可直连。",
		Recommended: true,
	},
	{
		Provider:     "openai",
		Label:        "OpenAI",
		APIBase:      "https://api.openai.com/v1",
		DefaultModel: "gpt-4o-mini",
		AvailableModels: []string{
			"gpt-4o-mini",
			"gpt-4o",
			"gpt-4-turbo",
			"gpt-3.5-turbo",
		},
		Description: "官方 OpenAI（需海外网络）；推荐 gpt-4o-mini 性价比最高。",
	},
	{
		Provider:     "zhipu",
		Label:        "智谱 GLM",
		APIBase:      "https://open.bigmodel.cn/api/paas/v4",
		DefaultModel: "glm-4-air",
		AvailableModels: []string{
			"glm-4-air",
			"glm-4-flash",
			"glm-4-plus",
			"glm-4",
		},
		Description: "清华系 GLM 系列，国内访问稳定，glm-4-air 极便宜。",
	},
	{
		Provider:     "anthropic",
		Label:        "Claude（Anthropic）",
		APIBase:      "https://api.anthropic.com/v1",
		DefaultModel: "claude-3-5-haiku-20241022",
		AvailableModels: []string{
			"claude-3-5-haiku-20241022",
			"claude-3-5-sonnet-20241022",
		},
		Description: "Anthropic Claude，长上下文（200K），需海外代理。",
	},
	{
		Provider:        "ollama",
		Label:           "本地 Ollama",
		APIBase:         "http://127.0.0.1:11434/v1",
		DefaultModel:    "qwen2.5:7b",
		AvailableModels: []string{"qwen2.5:7b", "llama3.1:8b", "mistral:7b"},
		Description:     "本地推理，零费用；需先用 Ollama 拉取模型。⚠ 与 BlockLocalAI 互斥。",
	},
}

// ListAIProviderPresets 返回所有预设的副本（避免外部修改全局表）
func ListAIProviderPresets() []AIProviderPreset {
	out := make([]AIProviderPreset, len(builtinAIPresets))
	copy(out, builtinAIPresets)
	return out
}

// FindAIProviderPreset 按 provider 标识符（不区分大小写）查找预设
func FindAIProviderPreset(provider string) (*AIProviderPreset, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return nil, false
	}
	for i := range builtinAIPresets {
		if builtinAIPresets[i].Provider == provider {
			cp := builtinAIPresets[i]
			return &cp, true
		}
	}
	return nil, false
}

// QwenPreset 通义千问的推荐预设（独立 getter，便于一键配置接口直接调用）
func QwenPreset() AIProviderPreset {
	if p, ok := FindAIProviderPreset("qwen"); ok {
		return *p
	}
	// 兜底（理论不可达，仅防御）
	return AIProviderPreset{
		Provider:     "qwen",
		Label:        "通义千问",
		APIBase:      "https://dashscope.aliyuncs.com/compatible-mode/v1",
		DefaultModel: "qwen-flash-2025-07-28",
	}
}
