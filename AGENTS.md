# AGENTS — AI 에이전트 작업 규칙 (이 저장소)

이 파일은 세션 시작 시 자동으로 읽힌다. 이 프로젝트에서 작업하는 AI는 아래 규칙을 지킨다.

## 1. `DECISIONS.md`를 먼저 읽어라
- 모든 구현 세션은 가이드 전체가 아니라 루트 [`DECISIONS.md`](./DECISIONS.md)에서 시작한다.
- **거기 없는 결정을 임의로 새로 내리지 말 것.** 필요한 결정이 비어 있으면 멈추고 사용자에게 보고·확인한다.

## 2. 로컬 실행은 `scripts/dev.sh`로만
- 서버/클라 기동·종료는 **반드시 `scripts/dev.sh`**로 한다. `pnpm dev`·`nest start`·`vite`를 직접(특히 백그라운드 `&`) 실행하지 않는다 — 고아 프로세스·포트 충돌·로그 유실 방지.
- 절차: 실행 전 `scripts/dev.sh status` → `start`(또는 `restart`) → 로그는 `.dev/logs/*.log` **파일을 직접 읽기** → 작업 끝나면 `stop`.
- `dev.sh logs`는 스냅샷(최근 100줄)이다. **`logs -f`(follow)는 금지** — 세션이 타임아웃까지 블록된다 (사람 전용 옵션).
- 포트: api 4200(`/health`) · web 5173. 디버깅은 `.vscode/launch.json`(API attach 9229 / Web Chrome).

## 3. 마무리·커밋 전 `pnpm verify`
- 작업을 "검증 통과"로 보고하려면 **`pnpm verify`(lint→build→유닛→e2e)의 실제 출력**이 근거여야 한다. 체크리스트를 개별 수동 실행으로 대체하지 않는다.
- **배포/Docker/compose 관련 변경**이면 `pnpm verify:full`(+ docker build 전 target + compose config + dist placeholder)까지 돌린다.

## 4. 콘솔 출력은 파일로 받아서 분석
- 빌드/테스트/린트 등 **출력이 긴 명령은 `tee`로 파일에 저장한 뒤 파일에서 grep/Read** 한다. `command 2>&1 | grep ...`, `| tail -5` 처럼 **저장 없이 직접 파이프 금지** — 전체 출력이 유실돼 다른 에러를 놓치고, 확인하려고 같은 명령을 또 돌리게 된다.
- 결과 확인만을 위해 동일 명령을 재실행하지 않는다. 부족하면 저장된 파일에서 다시 찾는다.

```bash
# ✅ 저장 후 분석
mkdir -p .dev/tmp
pnpm build 2>&1 | tee .dev/tmp/build.txt
grep -n "error" .dev/tmp/build.txt

# ❌ 저장 없이 파이프 (전체 출력 유실)
pnpm build 2>&1 | grep "error"
pnpm test 2>&1 | tail -5
```

## 5. 가이드 + 에스컬레이션
- 스택·패턴·구조의 단일 진실은 가이드다: <https://project-template.mygen.site/llms.txt>.
- 가이드의 **escalation** 대상 항목(되돌리기 어려운 결정·보안·비용·데이터 파괴 등)에 해당하면 **멈추고 사용자에게 확인**한 뒤 진행한다.

## 6. 스택/패턴은 가이드 우선
- 라이브러리·구조·컨벤션을 새로 고르기 전에 가이드에 이미 정해진 게 있는지 본다. 가이드와 어긋나는 선택은 근거를 남기고 사용자와 합의한다.

## 7. 파일 삭제 금지 (최우선 — 다른 규칙보다 우선)
- **이 세션에서 직접 만들지 않은 파일을 `rm`·`git clean`·`git checkout --` 등으로 삭제하지 않는다.** "불필요해 보인다", "자동 생성 같다"는 판단으로도 금지 — 판단은 사용자가 한다.
- `git status`의 untracked(`??`) 파일도 다른 도구/사용자가 만든 것일 수 있다. 임의 삭제 금지.
- 삭제가 필요하면 **경로와 이유를 제시하고 명시적 승인 후에만**.

## 8. 파일 배치 / 저장소 구조
- 허용 최상위: `apps/` `packages/` `scripts/` `docs/` `.vscode/` `.dev/` (+ 루트 설정 파일). **루트에 소스/산출물 파일을 만들지 않는다.**
- 프로덕션 코드 → `apps/`, 공유 코드/스키마 → `packages/`, 문서 → `docs/`.
- **스크린샷·QA 산출물·스크래치 등 로컬 생성물은 `.dev/` 아래에만** — 커밋되지 않는 영역이다 (`.gitkeep`으로 폴더만 유지). 루트에 `*.png` 같은 파일 금지.

## 9. Git 규칙
- **다른 목적의 작업으로 전환하기 전에 현재 작업을 커밋한다** (사용자에게 유도). 서로 다른 목적의 변경을 한 커밋에 섞지 않는다.
- 사용자가 "전부 커밋/푸시"를 요청하면: `git status` 확인 → `git add -A` (**untracked 포함** — "이미 있는 것 같다"로 건너뛰지 않음) → 커밋/푸시 → `git status`로 잔여 확인, 남으면 보고.
- 대량 포맷/이관 변경은 기능 커밋과 분리한다.

## 10. 린트
- `biome-ignore`는 반드시 이유를 명시한다.
- 자동 수정 가능한 위반은 손으로 고치지 말고 `pnpm lint:fix`에 맡긴다.
