package version

import "os"

// Version 由发布构建通过 -ldflags 注入；本地未注入时使用默认值。
var Version = "0.1.0"

// Current 返回当前应用版本，优先使用运行环境变量覆盖。
func Current() string {
	if envVersion := os.Getenv("NOWEN_VERSION"); envVersion != "" {
		return envVersion
	}
	if envVersion := os.Getenv("APP_VERSION"); envVersion != "" {
		return envVersion
	}
	return Version
}
