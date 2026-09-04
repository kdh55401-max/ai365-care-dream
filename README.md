## 60초 AI 돌봄보고 (CARE REPORT) 실증 파일럿 — /care, /admin

2026-09-07~09-18 요양보호사 9명 실증용 화면. 이 저장소의 다른 화면(TEAM/CARE/
COMMUNITY 확장형 MVP, 생활안전스캐너)과는 별도로 동작하며 서로 영향을 주지 않는다.

- 요양보호사용: `/care` — [사용법](docs/CARE_GUIDE.md)
- 관리자용: `/admin` — [검증 가이드](docs/ADMIN_GUIDE.md)
- 배포 전 준비: [실증 준비 체크리스트](docs/PILOT_LAUNCH_CHECKLIST.md)
- DB 스키마: [db/schema.sql](db/schema.sql)
- 환경변수: [.env.local.example](.env.local.example)
- 변경 이력: [CHANGE_LOG.md](CHANGE_LOG.md), 이후 아이디어: [LATER_IDEAS.md](LATER_IDEAS.md)

```bash
npm install
npm run lint
npm test
npm run build
```

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
