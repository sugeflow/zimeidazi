# 前端来源

本目录复制自 Easel 上游 `web/frontend/`，基线 commit：`de08f20`（2026-09-28）。
之后的 UI 重构都在这里进行，构建产物替换掉上游前端（见 `scripts/stage_easel.py`）。

后端 API 仍然用上游的。同步上游时：

```bash
git -C upstream/Easel diff de08f20..<新版本> -- web/frontend/src/lib/api.ts
```

重点关注 `src/lib/api.ts` 里接口的变化，按需移植到这里，再更新上面的基线 commit。
