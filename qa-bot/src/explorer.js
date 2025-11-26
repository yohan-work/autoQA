/**
 * explorer.js - 페이지 자동 탐색 모듈
 *
 * 이 모듈은 페이지에서 자동으로 상호작용을 수행합니다:
 * - 뷰포트 리사이즈
 * - 스크롤
 * - 입력 필드에 텍스트 입력
 * - 버튼/링크 클릭
 */

const path = require("path");

// 기본 뷰포트 설정 (viewportSets가 없을 경우 사용)
const DEFAULT_VIEWPORT = [{ width: 1280, height: 720, label: "default" }];

// 위험한 텍스트 패턴 (클릭 시 스킵)
const DANGEROUS_PATTERNS = ["delete", "탈퇴", "삭제"];

/**
 * 페이지 탐색 메인 함수
 * 뷰포트별로 스크롤, 타이핑, 클릭을 수행합니다.
 *
 * @param {import('playwright').Page} page - Playwright 페이지 객체
 * @param {Object} options - 옵션
 * @param {Object} options.target - 타겟 설정 객체
 * @param {string} options.screenshotsDir - 스크린샷 저장 경로
 * @returns {Promise<{steps: Array, errors: Array}>}
 */
async function explorePage(page, { target, screenshotsDir }) {
  const steps = [];
  const errors = [];

  // 뷰포트 설정 가져오기 (없으면 기본값 사용)
  const viewportSets = target.viewportSets || DEFAULT_VIEWPORT;
  const maxClicks = target.maxClicks || 20;

  try {
    // 각 뷰포트에 대해 탐색 수행
    for (let i = 0; i < viewportSets.length; i++) {
      const viewport = viewportSets[i];
      const { width, height, label } = viewport;

      console.log(
        `    [뷰포트 ${i + 1}/${
          viewportSets.length
        }] ${label} (${width}x${height})`
      );

      // 1. 뷰포트 크기 변경
      await page.setViewportSize({ width, height });
      await wait(50); // 렌더링 대기 (최적화: 500ms → 100ms → 50ms)

      steps.push({ type: "viewport", width, height, label });

      // 2. 뷰포트 변경 후 스크린샷
      const viewportScreenshot = path.join(
        screenshotsDir,
        `viewport-${i}_${label}.png`
      );
      await safeScreenshot(page, viewportScreenshot, errors);

      // 3. 스크롤 테스트
      const scrollSteps = await scrollPage(page);
      steps.push(...scrollSteps);

      // 4. 스크롤 후 스크린샷
      const afterScrollScreenshot = path.join(
        screenshotsDir,
        `after-scroll-${i}_${label}.png`
      );
      await safeScreenshot(page, afterScrollScreenshot, errors);

      // 5. 입력 필드에 타이핑 (성능 최적화를 위해 제거)
      // const typeSteps = await typeIntoInputs(page);
      // steps.push(...typeSteps);

      // 6. 버튼/링크 클릭
      const clickSteps = await clickButtons(page, maxClicks);
      steps.push(...clickSteps);
    }
  } catch (error) {
    // 전체 탐색 중 예상치 못한 에러
    errors.push(`탐색 중 에러 발생: ${error.message}`);
    console.log(`    [ERROR] 탐색 실패: ${error.message}`);
  }

  return { steps, errors };
}

/**
 * 페이지를 단계적으로 스크롤합니다.
 * 페이지를 2개 구간으로 나누어 빠르게 이동하며 각 위치를 기록합니다. (최적화)
 *
 * @param {import('playwright').Page} page - Playwright 페이지 객체
 * @returns {Promise<Array>} 스크롤 스텝 배열
 */
async function scrollPage(page) {
  const steps = [];

  try {
    // 전체 스크롤 높이 가져오기
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);

    // 페이지를 2개 구간으로 나눔 (최적화: 0%, 100%)
    const positions = [0, 1.0];

    for (const posRatio of positions) {
      const scrollPos = Math.floor(scrollHeight * posRatio);

      // 스크롤 실행
      await page.evaluate((pos) => window.scrollTo(0, pos), scrollPos);
      await wait(50); // 최적화: 300ms → 100ms → 50ms

      steps.push({ type: "scroll", position: scrollPos });
    }

    // 다시 맨 위로
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(50); // 최적화: 300ms → 100ms → 50ms
  } catch (error) {
    steps.push({ type: "scroll-error", error: error.message });
  }

  return steps;
}

/**
 * 페이지의 입력 필드에 텍스트를 입력합니다.
 * 성능 최적화를 위해 첫 3개 입력 필드만 테스트합니다.
 *
 * @param {import('playwright').Page} page - Playwright 페이지 객체
 * @returns {Promise<Array>} 타이핑 스텝 배열
 */
async function typeIntoInputs(page) {
  const steps = [];
  const MAX_INPUTS_TO_TEST = 3; // 최적화: 첫 3개만 테스트

  // 대상 입력 필드 셀렉터
  const selector = [
    'input[type="text"]',
    'input[type="email"]',
    'input[type="search"]',
    "textarea",
    "input:not([type])",
  ].join(", ");

  try {
    // 모든 입력 필드 찾기
    const inputs = await page.locator(selector).all();
    let testedCount = 0;

    for (
      let i = 0;
      i < inputs.length && testedCount < MAX_INPUTS_TO_TEST;
      i++
    ) {
      const input = inputs[i];

      try {
        // 요소가 보이는지 확인
        if (!(await input.isVisible())) {
          continue;
        }

        // 스크롤하여 요소가 보이도록
        await input.scrollIntoViewIfNeeded();
        await wait(50); // 최적화: 200ms → 50ms

        // 클릭하여 포커스
        await input.click();
        await wait(50); // 최적화: 100ms → 50ms

        // 텍스트 입력
        await input.fill(`test-input-${i}`);
        await wait(50); // 최적화: 200ms → 50ms

        steps.push({ type: "type", index: i });
        testedCount++;
      } catch (inputError) {
        steps.push({
          type: "type-error",
          index: i,
          error: inputError.message,
        });
      }
    }
  } catch (error) {
    steps.push({ type: "type-error", index: -1, error: error.message });
  }

  return steps;
}

/**
 * 페이지의 버튼과 링크를 클릭합니다.
 * 위험한 텍스트가 포함된 요소는 건너뜁니다.
 * 클릭 후 팝업이 열리면 자동으로 닫습니다.
 *
 * @param {import('playwright').Page} page - Playwright 페이지 객체
 * @param {number} maxClicks - 최대 클릭 횟수
 * @returns {Promise<Array>} 클릭 스텝 배열
 */
async function clickButtons(page, maxClicks = 20) {
  const steps = [];

  // 클릭 대상 셀렉터
  const selector = 'button, a[href], [role="button"]';

  try {
    // 모든 클릭 가능한 요소 찾기
    const elements = await page.locator(selector).all();

    let clickCount = 0;

    for (let i = 0; i < elements.length && clickCount < maxClicks; i++) {
      const element = elements[i];

      try {
        // 요소가 보이는지 확인
        if (!(await element.isVisible())) {
          continue;
        }

        // 태그명과 텍스트 추출
        let tagName = "";
        let text = "";

        try {
          tagName = await element.evaluate((el) => el.tagName.toLowerCase());
          text = await element.innerText();
          text = text.trim().substring(0, 50); // 50자로 제한
        } catch {
          // 추출 실패 시 무시
        }

        // 위험한 텍스트 체크
        const lowerText = text.toLowerCase();
        const isDangerous = DANGEROUS_PATTERNS.some((pattern) =>
          lowerText.includes(pattern.toLowerCase())
        );

        if (isDangerous) {
          steps.push({
            type: "skip-click",
            index: i,
            reason: "dangerous-text",
            text,
          });
          continue;
        }

        // 스크롤하여 요소가 보이도록
        await element.scrollIntoViewIfNeeded();
        await wait(20); // 최적화: 200ms → 50ms → 20ms

        // 클릭 실행
        await element.click();
        await wait(100); // 최적화: 1000ms → 200ms → 100ms (팝업 렌더링 대기)

        // 팝업/모달 자동 닫기: ESC 키 시도
        await page.keyboard.press("Escape");
        await wait(50); // 최적화: 100ms → 50ms

        steps.push({ type: "click", index: i, tagName, text });
        clickCount++;
      } catch (clickError) {
        steps.push({
          type: "click-error",
          index: i,
          error: clickError.message,
        });
      }
    }
  } catch (error) {
    steps.push({ type: "click-error", index: -1, error: error.message });
  }

  return steps;
}

/**
 * 안전하게 스크린샷을 촬영합니다.
 * 실패 시 에러 배열에 추가합니다.
 *
 * @param {import('playwright').Page} page - Playwright 페이지 객체
 * @param {string} filepath - 저장 경로
 * @param {Array} errors - 에러 배열
 */
async function safeScreenshot(page, filepath, errors) {
  try {
    await page.screenshot({ path: filepath });
  } catch (error) {
    errors.push(`스크린샷 실패 (${filepath}): ${error.message}`);
  }
}

/**
 * 지정된 시간만큼 대기합니다.
 *
 * @param {number} ms - 대기 시간 (밀리초)
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { explorePage };
