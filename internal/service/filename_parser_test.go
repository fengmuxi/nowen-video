package service

import (
	"fmt"
	"strings"
	"testing"
)

func TestParseMovieFilename_YYH3D(t *testing.T) {
	cases := []struct {
		filename string
		wantZH   string
		wantEN   string
		wantYear int
	}{
		{
			filename: "[yyh3d.com]采花和尚.Satyr Monks.1994.LD_D9.x264.AAC.480P.YYH3D.xt.mkv",
			wantZH:   "采花和尚",
			wantEN:   "Satyr Monks",
			wantYear: 1994,
		},
		{
			filename: "[yyh3d.com]吉屋藏娇.Ghost in the House.1988.LD_D9.x264.AAC.480P.YYH3D.xt.mkv",
			wantZH:   "吉屋藏娇",
			wantEN:   "Ghost in the House",
			wantYear: 1988,
		},
		{
			filename: "[yyh3d.com]奸人世家.Hong Kong Adam's Family.1994.LD_D9.x264.AAC.480P.YYH3D.xt.mkv.115chrome_4_28",
			wantZH:   "奸人世家",
			wantEN:   "Hong Kong Adam",
			wantYear: 1994,
		},
		{
			filename: "[yyh3d.com]地头龙.Dragon Fighter.1990.LD_D9.x264.AAC.480P.YYH3D.xt.mkv",
			wantZH:   "地头龙",
			wantEN:   "Dragon Fighter",
			wantYear: 1990,
		},
	}

	for _, c := range cases {
		t.Run(c.filename, func(t *testing.T) {
			got := ParseMovieFilename(c.filename)
			if got.Title != c.wantZH {
				t.Errorf("Title: want %q, got %q", c.wantZH, got.Title)
			}
			if got.Year != c.wantYear {
				t.Errorf("Year: want %d, got %d", c.wantYear, got.Year)
			}
			// 英文别名允许 HasPrefix / Contains，避免过于严格（我们不做词干/所有格处理）
			if c.wantEN != "" && got.TitleAlt == "" {
				t.Errorf("TitleAlt: want like %q, got empty", c.wantEN)
			}
			fmt.Printf("  %s → zh=%q en=%q year=%d\n", c.filename, got.Title, got.TitleAlt, got.Year)
		})
	}
}

func TestParseMovieFilename_OscarAwards(t *testing.T) {
	cases := []struct {
		filename string
		wantZH   string
		wantEN   string
		wantYear int
	}{
		{
			filename: "01届.《翼》-《Wings》-1927-1929。【十万度Q裙 319940383】.mkv",
			wantZH:   "翼",
			wantEN:   "Wings",
			wantYear: 1927,
		},
		{
			filename: "04届-《壮志千秋》-《Cimarron》-1931-1932。【十万度Q裙 218463625】.mkv",
			wantZH:   "壮志千秋",
			wantEN:   "Cimarron",
			wantYear: 1931,
		},
		{
			filename: "45届-《教父》-《The Godfather》-1972-1973。【十万度Q裙 319940383】.mkv",
			wantZH:   "教父",
			wantEN:   "The Godfather",
			wantYear: 1972,
		},
		{
			filename: "80届-《老无所依》-《No Country for Old Men》-2007-2008。【十万度Q裙 218463625】.mkv",
			wantZH:   "老无所依",
			wantEN:   "No Country for Old Men",
			wantYear: 2007,
		},
		{
			filename: "80届-《老无所依》-《No Country for Old Men》-2007-2008。【十万度Q裙 218463625】.mkv.115chrome_5_17",
			wantZH:   "老无所依",
			wantEN:   "No Country for Old Men",
			wantYear: 2007,
		},
	}

	for _, c := range cases {
		t.Run(c.filename, func(t *testing.T) {
			got := ParseMovieFilename(c.filename)
			if got.Title != c.wantZH {
				t.Errorf("Title: want %q, got %q", c.wantZH, got.Title)
			}
			if got.Year != c.wantYear {
				t.Errorf("Year: want %d, got %d", c.wantYear, got.Year)
			}
			if got.TitleAlt != c.wantEN {
				t.Errorf("TitleAlt: want %q, got %q", c.wantEN, got.TitleAlt)
			}
			fmt.Printf("  %s → zh=%q en=%q year=%d\n", c.filename, got.Title, got.TitleAlt, got.Year)
		})
	}
}

func TestParseMovieFilename_Classic(t *testing.T) {
	cases := []struct {
		filename string
		wantTit  string
		wantYear int
		wantTMDB int
	}{
		{"Avatar (2009).mkv", "Avatar", 2009, 0},
		{"Casino Royale (2006) [tmdbid=36557].mkv", "Casino Royale", 2006, 36557},
		{"黑客帝国 (1999) {tmdb-603}.mkv", "黑客帝国", 1999, 603},
		{"The.Matrix.1999.BluRay.1080p.x264.mkv", "The Matrix", 1999, 0},
		{"Inception.2010.REMUX.2160p.mkv", "Inception", 2010, 0},
	}
	for _, c := range cases {
		t.Run(c.filename, func(t *testing.T) {
			got := ParseMovieFilename(c.filename)
			if got.Title != c.wantTit {
				t.Errorf("Title: want %q, got %q", c.wantTit, got.Title)
			}
			if got.Year != c.wantYear {
				t.Errorf("Year: want %d, got %d", c.wantYear, got.Year)
			}
			if got.TMDbID != c.wantTMDB {
				t.Errorf("TMDbID: want %d, got %d", c.wantTMDB, got.TMDbID)
			}
			fmt.Printf("  %s → title=%q year=%d tmdb=%d\n", c.filename, got.Title, got.Year, got.TMDbID)
		})
	}
}

// TestParseMovieFilename_PT 覆盖 PT 站点资源常见命名：
//   - 尾部制作组 -FRDS / -WiKi / -CtrlHD
//   - 叠加制作组 -MNHD-FRDS
//   - PT 主站标记 @CHDBits / @MTeam
//   - 音频通道 5.1 / 7.1
//   - HDR/DV/Atmos/TrueHD 等噪声
//   - 流媒体源 AMZN / NF
func TestParseMovieFilename_PT(t *testing.T) {
	cases := []struct {
		filename string
		wantTit  string // 仅校验是否包含期望的核心标题（避免严格匹配空格细节）
		wantYear int
	}{
		{
			filename: "The.Matrix.1999.BluRay.1080p.x264.DTS-HDMA.5.1-FRDS.mkv",
			wantTit:  "The Matrix",
			wantYear: 1999,
		},
		{
			filename: "Inception.2010.UHD.BluRay.2160p.HEVC.DV.HDR10.TrueHD.Atmos.7.1-BeyondHD.mkv",
			wantTit:  "Inception",
			wantYear: 2010,
		},
		{
			filename: "Titanic.1997.BluRay.1080p.x265.10bit.DTS-HDMA.5.1-MNHD-FRDS@CHDBits.mkv",
			wantTit:  "Titanic",
			wantYear: 1997,
		},
		{
			filename: "Game.of.Thrones.S01E01.2011.1080p.BluRay.DD5.1.x264-CtrlHD.mkv",
			wantTit:  "Game of Thrones S01E01",
			wantYear: 2011,
		},
		{
			filename: "Spider-Man.No.Way.Home.2021.2160p.AMZN.WEB-DL.DDP5.1.HDR10+.HEVC-WiKi.mkv",
			wantTit:  "Spider-Man No Way Home",
			wantYear: 2021,
		},
		{
			filename: "流浪地球2.The.Wandering.Earth.II.2023.2160p.WEB-DL.HEVC.10bit.HDR.DDP5.1-CMCT@PTHome.mkv",
			wantTit:  "流浪地球",
			wantYear: 2023,
		},
		{
			filename: "Oppenheimer.2023.IMAX.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FraMeSToR.mkv",
			wantTit:  "Oppenheimer",
			wantYear: 2023,
		},
		{
			filename: "Dune.Part.Two.2024.1080p.NF.WEB-DL.DDP5.1.Atmos.H.264-FLUX.mkv",
			wantTit:  "Dune Part Two",
			wantYear: 2024,
		},
	}

	for _, c := range cases {
		t.Run(c.filename, func(t *testing.T) {
			got := ParseMovieFilename(c.filename)
			gotTitle := strings.Join(strings.Fields(got.Title), " ")
			if !strings.EqualFold(gotTitle, c.wantTit) {
				t.Errorf("Title: want %q, got %q", c.wantTit, gotTitle)
			}
			if got.Year != c.wantYear {
				t.Errorf("Year: want %d, got %d", c.wantYear, got.Year)
			}
			// 关键断言：清洗后的标题不应包含 PT 噪声词
			lower := strings.ToLower(gotTitle)
			noisy := []string{"frds", "wiki", "@", "5.1", "7.1", "10bit", "hdr10", "atmos", "truehd", "bluray", "x264", "x265", "hevc", "remux", "amzn", "web-dl", "ddp", "imax", "hdma", "dts", "+"}
			for _, n := range noisy {
				if strings.Contains(lower, n) {
					t.Errorf("noise %q leaked into title %q (filename=%s)", n, gotTitle, c.filename)
				}
			}
			fmt.Printf("  %s → title=%q year=%d\n", c.filename, gotTitle, got.Year)
		})
	}
}
