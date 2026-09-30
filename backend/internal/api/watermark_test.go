package api

import (
	"strings"
	"testing"
)

func TestBuildWatermarkPostScript_Layouts(t *testing.T) {
	tests := []struct {
		name       string
		text       string
		layout     string
		opacity    float64
		wantSub    []string
		notWantSub []string
	}{
		{
			name:    "Center Horizontal",
			text:    "CONFIDENTIAL",
			layout:  "center",
			opacity: 0.30,
			wantSub: []string{
				"/EndPage",
				"clippath pathbbox",
				"CONFIDENTIAL",
				"pCx pCy translate",
				"actualW 2 div neg",
				"0.79 setgray",
			},
		},
		{
			name:    "Diagonal 45 degrees",
			text:    "DRAFT COPY",
			layout:  "diagonal",
			opacity: 0.15,
			wantSub: []string{
				"/EndPage",
				"45 rotate",
				"DRAFT COPY",
				"0.89 setgray",
			},
		},
		{
			name:    "Top Header",
			text:    "STRICTLY PRIVATE",
			layout:  "top",
			opacity: 0.50,
			wantSub: []string{
				"/EndPage",
				"urY 45 sub translate",
				"STRICTLY PRIVATE",
				"0.65 setgray",
			},
		},
		{
			name:    "Bottom Footer",
			text:    "INTERNAL USE ONLY",
			layout:  "bottom",
			opacity: 0.30,
			wantSub: []string{
				"/EndPage",
				"llY 45 add translate",
				"INTERNAL USE ONLY",
			},
		},
		{
			name:    "Special characters escaping",
			text:    "Confidential (Copy #1) & 100% Valid\\Safe",
			layout:  "center",
			opacity: 0.30,
			wantSub: []string{
				`Confidential \(Copy #1\) & 100% Valid\\Safe`,
			},
			notWantSub: []string{
				"Valid\\Safe", // unescaped backslash must not appear
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ps := buildWatermarkPostScript(tc.text, tc.layout, tc.opacity)
			for _, sub := range tc.wantSub {
				if !strings.Contains(ps, sub) {
					t.Errorf("expected PS to contain %q, but got:\n%s", sub, ps)
				}
			}
			for _, notSub := range tc.notWantSub {
				if strings.Contains(ps, notSub) {
					t.Errorf("expected PS NOT to contain %q", notSub)
				}
			}
		})
	}
}
