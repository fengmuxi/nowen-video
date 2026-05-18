// Package crypto 提供项目内敏感字段（如 AI API Key / 网盘账号密码）的对称加解密能力。
//
// 设计目标：
//
//  1. 零依赖：仅使用 Go 标准库 crypto/aes + crypto/cipher（GCM 模式）
//  2. 透明兼容：未加密的明文 key（不带 ENC: 前缀）在解密时直接返回原值，
//     从而保证旧 yaml 配置零迁移成本
//  3. 主密钥懒加载：首次调用 EnsureMasterKey 时，
//     若 ./config/.master.key 不存在则随机生成 32 字节并写入（权限 0o600）
//
// 加密产物格式（base64 编码的 [nonce(12B) | ciphertext | tag(16B)]，外层带 "ENC:" 前缀）：
//
//	ENC:<base64>
//
// 调用方约定：
//   - Encrypt("sk-xxxxxxxx") -> "ENC:abcdef..."
//   - Decrypt("ENC:abcdef...") -> "sk-xxxxxxxx"
//   - Decrypt("sk-xxxxxxxx") -> "sk-xxxxxxxx"  // 兼容旧明文
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// EncPrefix 加密产物的统一前缀（用于运行时识别"已加密 vs 明文"）
const EncPrefix = "ENC:"

var (
	masterKeyOnce sync.Once
	masterKey     []byte
	masterKeyErr  error
)

// EnsureMasterKey 加载或生成主密钥，并返回 32 字节 AES-256 密钥。
//
// 行为：
//  1. 优先从环境变量 NOWEN_MASTER_KEY 读取（base64，方便 docker secret 注入）；
//  2. 否则尝试从 ./config/.master.key 加载；
//  3. 都没有则生成 32 字节随机密钥并写入 ./config/.master.key（0o600 权限）。
//
// 该函数线程安全且全局只执行一次。
func EnsureMasterKey() ([]byte, error) {
	masterKeyOnce.Do(func() {
		// 1) 环境变量
		if envKey := strings.TrimSpace(os.Getenv("NOWEN_MASTER_KEY")); envKey != "" {
			raw, err := base64.StdEncoding.DecodeString(envKey)
			if err != nil {
				masterKeyErr = fmt.Errorf("环境变量 NOWEN_MASTER_KEY 不是有效 base64: %w", err)
				return
			}
			if len(raw) != 32 {
				masterKeyErr = fmt.Errorf("NOWEN_MASTER_KEY 长度必须为 32 字节，实际 %d", len(raw))
				return
			}
			masterKey = raw
			return
		}

		// 2) 文件
		// 搜索路径：优先项目根 ./config，其次 ./data/config，最后 /etc/nowen-video/config
		dirs := []string{"./config", "./data/config", "/etc/nowen-video/config"}
		var keyFile string
		for _, dir := range dirs {
			candidate := filepath.Join(dir, ".master.key")
			if _, err := os.Stat(candidate); err == nil {
				keyFile = candidate
				break
			}
		}
		if keyFile != "" {
			raw, err := os.ReadFile(keyFile)
			if err != nil {
				masterKeyErr = fmt.Errorf("读取主密钥文件失败: %w", err)
				return
			}
			// 文件内可能是 base64 也可能是裸 32 字节（兼容老格式）
			cleaned := strings.TrimSpace(string(raw))
			if len(cleaned) >= 40 { // base64(32) ≈ 44
				if decoded, err := base64.StdEncoding.DecodeString(cleaned); err == nil && len(decoded) == 32 {
					masterKey = decoded
					return
				}
			}
			if len(raw) == 32 {
				masterKey = raw
				return
			}
			masterKeyErr = fmt.Errorf("主密钥文件 %s 内容长度异常（应为 32 字节或 base64 编码 32 字节）", keyFile)
			return
		}

		// 3) 生成
		raw := make([]byte, 32)
		if _, err := io.ReadFull(rand.Reader, raw); err != nil {
			masterKeyErr = fmt.Errorf("生成主密钥失败: %w", err)
			return
		}
		// 默认写到 ./config/.master.key，目录不存在则创建
		_ = os.MkdirAll("./config", 0o755)
		target := filepath.Join("./config", ".master.key")
		encoded := base64.StdEncoding.EncodeToString(raw)
		if err := os.WriteFile(target, []byte(encoded), 0o600); err != nil {
			masterKeyErr = fmt.Errorf("写入主密钥文件失败: %w", err)
			return
		}
		masterKey = raw
	})
	return masterKey, masterKeyErr
}

// IsEncrypted 判断字符串是否已是 ENC: 前缀的密文
func IsEncrypted(s string) bool {
	return strings.HasPrefix(s, EncPrefix)
}

// Encrypt 把明文用 AES-256-GCM 加密，返回带 "ENC:" 前缀的 base64 字符串。
// 空字符串原样返回（不加密空值）。
func Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	if IsEncrypted(plaintext) {
		// 已是密文，直接返回，避免重复包装
		return plaintext, nil
	}
	key, err := EnsureMasterKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	// 格式：nonce | ciphertext+tag
	out := append(nonce, sealed...)
	return EncPrefix + base64.StdEncoding.EncodeToString(out), nil
}

// Decrypt 解密带 "ENC:" 前缀的密文；不带前缀的明文直接返回。
// 空字符串原样返回。
func Decrypt(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	if !IsEncrypted(s) {
		// 兼容老明文：不报错
		return s, nil
	}
	body := strings.TrimPrefix(s, EncPrefix)
	raw, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return "", fmt.Errorf("密文 base64 解码失败: %w", err)
	}
	key, err := EnsureMasterKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("密文长度异常")
	}
	nonce := raw[:gcm.NonceSize()]
	ciphertext := raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败（主密钥不匹配或密文损坏）: %w", err)
	}
	return string(plain), nil
}

// MaskKey 把 API key 脱敏（保留首尾 4 字符），用于日志/前端展示。
//
//	"sk-1234567890abcdef" -> "sk-1***cdef"
func MaskKey(s string) string {
	if s == "" {
		return ""
	}
	if IsEncrypted(s) {
		return "ENC:***"
	}
	n := len(s)
	if n <= 8 {
		return strings.Repeat("*", n)
	}
	return s[:4] + "***" + s[n-4:]
}
