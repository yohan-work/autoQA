/**
 * runSmoke.js - QA 스모크 테스트 메인 러너
 *
 * 이 파일은 테스트의 진입점으로, 타겟 URL들을 순회하며
 * 브라우저를 제어하고 결과를 수집합니다.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { explorePage } = require("./explorer");
const { writeReport } = require("./reporter");

// 프로젝트 루트 경로 (qa-bot 폴더)
const PROJECT_ROOT = path.resolve(__dirname, "..");

// 디렉토리 경로 설정
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts");
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, "screenshots");
const VIDEOS_DIR = path.join(ARTIFACTS_DIR, "videos");
const REPORTS_DIR = path.join(PROJECT_ROOT, "reports");
const TARGETS_PATH = path.join(__dirname, "config", "targets.json");

/**
 * 필요한 디렉토리들을 생성합니다.
 * 이미 존재하는 경우 무시합니다.
 */
function ensureDirectories() {
  const dirs = [ARTIFACTS_DIR, SCREENSHOTS_DIR, VIDEOS_DIR, REPORTS_DIR];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[INFO] 디렉토리 생성: ${dir}`);
    }
  }
}

/**
 * 타겟 설정 파일을 읽어옵니다.
 * @returns {Array} 타겟 객체 배열
 */
function loadTargets() {
  const raw = fs.readFileSync(TARGETS_PATH, "utf-8");
  return JSON.parse(raw);
}

/**
 * 고유한 실행 ID를 생성합니다.
 * @returns {string} ISO 형식의 타임스탬프 기반 ID
 */
function generateRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * 메인 실행 함수
 * 모든 타겟에 대해 테스트를 수행하고 리포트를 생성합니다.
 */
async function runSmoke() {
  console.log("========================================");
  console.log("  QA Smoke Test Runner 시작");
  console.log("========================================\n");

  // 1. 디렉토리 확인 및 생성
  ensureDirectories();

  // 2. 타겟 설정 로드
  const targets = loadTargets();
  console.log(`[INFO] 총 ${targets.length}개의 타겟을 발견했습니다.\n`);

  // 3. 브라우저 실행 (headless 모드)
  const browser = await chromium.launch({ headless: true });
  console.log("[INFO] Chromium 브라우저 시작됨\n");

  // 4. 결과를 저장할 배열
  const results = [];

  // 5. 각 타겟에 대해 테스트 수행
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const runId = generateRunId();

    console.log(`----------------------------------------`);
    console.log(`[${i + 1}/${targets.length}] 타겟: ${target.name}`);
    console.log(`  URL: ${target.url}`);
    console.log(`----------------------------------------`);

    // 타겟별 스크린샷 저장 폴더 생성
    const targetScreenshotsDir = path.join(
      SCREENSHOTS_DIR,
      `${target.name}-${runId}`
    );
    fs.mkdirSync(targetScreenshotsDir, { recursive: true });

    // 결과 객체 초기화
    const result = {
      runId,
      target,
      navigationError: null,
      consoleMessages: [],
      failedRequests: [],
      exploration: { steps: [], errors: [] },
      videoPath: null,
      screenshotsDir: path.relative(PROJECT_ROOT, targetScreenshotsDir),
    };

    // 비디오 녹화를 위한 브라우저 컨텍스트 생성
    const context = await browser.newContext({
      recordVideo: {
        dir: VIDEOS_DIR,
        size: { width: 1280, height: 720 },
      },
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // 콘솔 메시지 수집 (에러 레벨만)
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        result.consoleMessages.push({
          type: msg.type(),
          text: msg.text(),
          location: msg.location(),
        });
      }
    });

    // 실패한 네트워크 요청 수집
    page.on("requestfailed", (request) => {
      result.failedRequests.push({
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText || "Unknown error",
      });
    });

    try {
      // 페이지 로드
      console.log(`  [STEP] 페이지 로딩 중...`);
      await page.goto(target.url, {
        waitUntil: "load",
        timeout: 45000,
      });
      console.log(`  [OK] 페이지 로드 완료`);

      // 초기 스크린샷 촬영
      const initialScreenshot = path.join(targetScreenshotsDir, "initial.png");
      await page.screenshot({ path: initialScreenshot });
      console.log(`  [OK] 초기 스크린샷 저장: initial.png`);

      // 탐색(exploration) 수행
      console.log(`  [STEP] 페이지 탐색 시작...`);
      const exploration = await explorePage(page, {
        target,
        screenshotsDir: targetScreenshotsDir,
      });
      result.exploration = exploration;
      console.log(
        `  [OK] 탐색 완료 - ${exploration.steps.length}개 스텝 수행됨`
      );
    } catch (error) {
      // 네비게이션 또는 탐색 중 에러 발생
      console.log(`  [ERROR] ${error.message}`);
      result.navigationError = error.message;

      // 에러 발생 시 스크린샷 시도
      try {
        const errorScreenshot = path.join(targetScreenshotsDir, "error.png");
        await page.screenshot({ path: errorScreenshot });
      } catch (screenshotError) {
        console.log(`  [WARN] 에러 스크린샷 실패: ${screenshotError.message}`);
      }
    }

    // 비디오 경로 수집 (컨텍스트 닫기 전에 경로 확보)
    const video = page.video();

    // 컨텍스트 닫기 (이때 비디오가 저장됨)
    await context.close();

    // 비디오 경로 저장
    if (video) {
      try {
        const videoPath = await video.path();
        result.videoPath = path.relative(PROJECT_ROOT, videoPath);
        console.log(`  [OK] 비디오 저장: ${result.videoPath}`);
      } catch (videoError) {
        console.log(`  [WARN] 비디오 경로 획득 실패: ${videoError.message}`);
      }
    }

    // 결과 배열에 추가
    results.push(result);
    console.log("");
  }

  // 6. 브라우저 종료
  await browser.close();
  console.log("[INFO] 브라우저 종료됨\n");

  // 7. HTML 리포트 생성
  console.log("[INFO] 리포트 생성 중...");
  const reportPath = await writeReport(results);
  console.log(`[SUCCESS] 리포트 생성 완료: ${reportPath}\n`);

  console.log("========================================");
  console.log("  QA Smoke Test 완료");
  console.log("========================================");
}

// 스크립트 실행
runSmoke().catch((error) => {
  console.error("[FATAL] 실행 중 치명적 에러 발생:", error);
  process.exit(1);
});
