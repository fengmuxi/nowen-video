//go:build windows

package service

import (
	"path/filepath"
	"syscall"
	"unsafe"
)

// statDevID 在 Windows 上没有稳定的 device id 概念；改用盘符大写值
func statDevID(p string) uint64 {
	v := filepath.VolumeName(p)
	if v == "" {
		return 0
	}
	// 把盘符转成数字（C=67、D=68 ...）
	var x uint64
	for _, r := range v {
		x = x*131 + uint64(r)
	}
	return x
}

// hardlinkCountPlatform Windows 上的硬链接数获取较繁琐，先返回 1（不参与告警）
func hardlinkCountPlatform(_ string) uint64 {
	return 1
}

// getFreeBytesPlatform 调 Windows API GetDiskFreeSpaceExW 获取可用字节
func getFreeBytesPlatform(dir string) uint64 {
	if dir == "" {
		return 0
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetDiskFreeSpaceExW")

	dirPtr, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		return 0
	}
	var freeBytesAvailable, totalBytes, totalFree uint64
	r1, _, _ := proc.Call(
		uintptr(unsafe.Pointer(dirPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if r1 == 0 {
		return 0
	}
	return freeBytesAvailable
}
