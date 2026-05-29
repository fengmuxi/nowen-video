.PHONY: all build run dev clean docker

VERSION ?= $(shell git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null | sed 's/^v//' || echo 0.1.0)
GO_VERSION_PKG := github.com/nowen-video/nowen-video/internal/version.Version
GO_LDFLAGS := -s -w -X $(GO_VERSION_PKG)=$(VERSION)

# 默认目标
all: build

# 构建后端
build:
	cd web && VITE_APP_VERSION=$(VERSION) npm run build
	CGO_ENABLED=1 NOWEN_VERSION=$(VERSION) go build -ldflags "$(GO_LDFLAGS)" -o bin/nowen-video ./cmd/server

# 仅构建后端
build-server:
	CGO_ENABLED=1 NOWEN_VERSION=$(VERSION) go build -ldflags "$(GO_LDFLAGS)" -o bin/nowen-video ./cmd/server

# 仅构建前端
build-web:
	cd web && VITE_APP_VERSION=$(VERSION) npm run build

# 开发模式运行后端
dev:
	NOWEN_DEBUG=true NOWEN_VERSION=$(VERSION) go run -ldflags "$(GO_LDFLAGS)" ./cmd/server

# 开发模式运行前端
dev-web:
	cd web && VITE_APP_VERSION=$(VERSION) npm run dev

# 运行（生产模式）
run: build
	./bin/nowen-video

# Docker构建
docker:
	docker-compose up --build -d

# Docker停止
docker-stop:
	docker-compose down

# 清理
clean:
	rm -rf bin/
	rm -rf cache/transcode/
	cd web && rm -rf dist/ node_modules/

# 安装前端依赖
install-web:
	cd web && npm install

# Go依赖整理
tidy:
	go mod tidy
