//go:build !windows

package service

import (
	"syscall"
)

// statDevID POSIX：使用 syscall.Stat_t.Dev
func statDevID(p string) uint64 {
	var st syscall.Stat_t
	if err := syscall.Stat(p, &st); err != nil {
		return 0
	}
	return uint64(st.Dev)
}

// hardlinkCountPlatform POSIX：返回 Nlink
func hardlinkCountPlatform(p string) uint64 {
	var st syscall.Stat_t
	if err := syscall.Stat(p, &st); err != nil {
		return 0
	}
	return uint64(st.Nlink)
}

// getFreeBytesPlatform POSIX：使用 statfs
func getFreeBytesPlatform(dir string) uint64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return 0
	}
	return uint64(st.Bavail) * uint64(st.Bsize)
}
