/**
 * explorer.js - 페이지 자동 탐색 모듈
 *
 * 이 모듈은 페이지에서 자동으로 상호작용을 수행합니다:
 * - 뷰포트 리사이즈
 * - 2단계 스크롤 및 상호작용 (단순 스크롤 -> 스크롤 & 클릭/입력)
 */

const path = require("path");

// 기본 뷰포트 설정 (viewportSets가 없을 경우 사용)
const DEFAULT_VIEWPORT = [{ width: 1280, height: 720, label: "default" }];

// 위험한 텍스트 패턴 (클릭 시 스킵)
const DANGEROUS_PATTERNS = ["delete", "탈퇴", "삭제", "logout", "signout", "로그아웃"];

/**
 * 페이지 탐색 메인 함수
 * 뷰포트별로 2단계 탐색(스크롤 -> 인터랙션)을 수행합니다.
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
      await wait(100);

      steps.push({ type: "viewport", width, height, label });

      // 2. 뷰포트 변경 후 스크린샷
      const viewportScreenshot = path.join(
        screenshotsDir,
        `viewport-${i}_${label}.png`
      );
      await safeScreenshot(page, viewportScreenshot, errors);

      // 3. 2단계 스크롤 및 상호작용 수행
      const interactionSteps = await performPhasedScrollAndInteract(page, maxClicks);
      steps.push(...interactionSteps);

      // 4. 탐색 완료 후 스크린샷
      const afterExploreScreenshot = path.join(
        screenshotsDir,
        `after-explore-${i}_${label}.png`
      );
      await safeScreenshot(page, afterExploreScreenshot, errors);
    }
  } catch (error) {
    // 전체 탐색 중 예상치 못한 에러
    errors.push(`탐색 중 에러 발생: ${error.message}`);
    console.log(`    [ERROR] 탐색 실패: ${error.message}`);
  }

  return { steps, errors };
}

/**
 * 2단계 스크롤 및 상호작용을 수행합니다.
 * Phase 1: 천천히 스크롤 다운 (페이지 로딩 유도) -> 최상단 이동
 * Phase 2: 천천히 스크롤 다운하면서 보이는 요소들과 상호작용
 *
 * @param {import('playwright').Page} page
 * @param {number} maxClicks
 */
async function performPhasedScrollAndInteract(page, maxClicks) {
  const steps = [];
  
  try {
    // === Phase 1: 단순 스크롤 다운 ===
    console.log("    [Phase 1] 페이지 로딩을 위한 스크롤 다운...");
    await smoothScrollDown(page, { speed: 'slow' });
    
    // 최상단으로 이동
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(500);
    steps.push({ type: "phase-1-complete" });

    // === Phase 2: 인터랙티브 스크롤 다운 ===
    console.log("    [Phase 2] 상호작용 스크롤 시작...");
    const interactSteps = await interactiveScrollDown(page, maxClicks);
    steps.push(...interactSteps);
    
  } catch (error) {
    steps.push({ type: "error", message: error.message });
    console.error(`    [ERROR] Phase 실행 중 오류: ${error.message}`);
  }

  return steps;
}

/**
 * 부드럽게 페이지 끝까지 스크롤합니다.
 * @param {import('playwright').Page} page 
 * @param {Object} options
 * @param {string} options.speed - 'slow' | 'normal' | 'fast'
 */
async function smoothScrollDown(page, { speed = 'normal' } = {}) {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  
  let currentPosition = 0;
  const stepSize = viewportHeight / 2; // 뷰포트 절반씩 이동
  const delay = speed === 'slow' ? 200 : 100;

  while (currentPosition < scrollHeight) {
    currentPosition += stepSize;
    await page.evaluate((pos) => {
      window.scrollTo({
        top: pos,
        behavior: 'smooth'
      });
    }, currentPosition);
    
    // 페이지 높이가 동적으로 변할 수 있으므로 갱신
    const newScrollHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newScrollHeight > scrollHeight) {
      // 무한 스크롤 등 대응 로직이 필요할 수 있으나 여기서는 간단히 처리
    }
    
    await wait(delay);
  }
  
  // 확실하게 끝까지
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  await wait(500);
}

/**
 * 스크롤하면서 보이는 요소들과 상호작용합니다.
 * @param {import('playwright').Page} page 
 * @param {number} maxClicks 
 */
async function interactiveScrollDown(page, maxClicks) {
  const steps = [];
  let clickCount = 0;
  let inputCount = 0;
  
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  
  let currentPosition = 0;
  const stepSize = viewportHeight * 0.8; // 뷰포트의 80%씩 이동하여 놓치는 요소 최소화

  // 이미 상호작용한 요소들을 추적하기 위한 Set (selector나 위치 기반)
  // 하지만 DOM이 변하므로 간단히 현재 뷰포트 내 요소만 처리
  
  while (currentPosition < scrollHeight) {
    // 1. 현재 뷰포트에서 상호작용 수행
    
    // 1-1. Input 요소 처리
    if (inputCount < 5) { // 최대 5개까지만 입력 테스트
      const inputSteps = await processVisibleInputs(page, inputCount);
      steps.push(...inputSteps);
      inputCount += inputSteps.length;
    }

    // 1-2. 클릭 요소 처리
    if (clickCount < maxClicks) {
      const clickSteps = await processVisibleClickables(page, maxClicks - clickCount);
      steps.push(...clickSteps);
      clickCount += clickSteps.length;
    }

    // 2. 스크롤 이동
    currentPosition += stepSize;
    await page.evaluate((pos) => {
      window.scrollTo({
        top: pos,
        behavior: 'smooth'
      });
    }, currentPosition);
    
    await wait(300); // 스크롤 후 렌더링 및 안정화 대기
    
    // 페이지 높이 갱신 확인
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentPosition >= newHeight) break;
  }
  
  return steps;
}

async function processVisibleInputs(page, startIndex) {
  const steps = [];
  // 현재 뷰포트에 보이는 input만 선택
  const inputs = await page.locator('input:visible, textarea:visible').all();
  
  for (const input of inputs) {
    try {
      // 이미 값이 있는지 확인 (간단한 체크)
      const value = await input.inputValue();
      if (value) continue;

      // 화면에 확실히 보이는지 체크 (중앙 좌표 등)
      // Playwright의 isVisible은 DOM 존재 여부 + 스타일 체크이므로 
      // 뷰포트 내 존재 여부는 scrollIntoViewIfNeeded가 처리해주지만,
      // 우리는 스크롤하면서 지나가는 중이므로 현재 보이는 것만 건드리는게 좋음.
      // 여기서는 간단히 try-catch로 진행
      
      const type = await input.getAttribute('type') || 'text';
      if (['hidden', 'submit', 'button', 'image', 'checkbox', 'radio'].includes(type)) continue;

      await input.click({ timeout: 1000 });
      await input.fill('QA Test');
      steps.push({ type: 'input', inputType: type });
      
      // 하나 처리하고 잠시 대기
      await wait(50);
    } catch (e) {
      // 무시
    }
  }
  return steps;
}

async function processVisibleClickables(page, remainingClicks) {
  const steps = [];
  let clicked = 0;
  
  // 현재 뷰포트에 보이는 클릭 가능한 요소들
  // 버튼, 링크, role=button
  const selector = 'button:visible, a[href]:visible, [role="button"]:visible';
  const elements = await page.locator(selector).all();
  
  for (const element of elements) {
    if (clicked >= remainingClicks) break;
    
    try {
      const text = (await element.innerText()).trim();
      if (!text) continue;
      
      // 위험한 텍스트 체크
      if (DANGEROUS_PATTERNS.some(p => text.toLowerCase().includes(p))) continue;
      
      // 화면 내에 있는지 대략적 확인 (BoundingBox)
      const box = await element.boundingBox();
      if (!box) continue;
      
      // 뷰포트 내에 있는지 확인 (스크롤 위치 고려 안해도 boundingBox는 뷰포트 기준? 아님 페이지 기준? 
      // Playwright boundingBox는 페이지 기준.
      // 하지만 우리는 interactiveScrollDown에서 스크롤을 제어하고 있음.
      // 그냥 click() 시도하면 Playwright가 알아서 스크롤하려 할 것임.
      // 여기서는 "보이는 것"을 클릭하는게 목표이므로 force: true를 쓰거나
      // 현재 스크롤 위치와 비교해야 함. 
      // 복잡도를 줄이기 위해 그냥 시도.
      
      await element.click({ timeout: 1000 });
      clicked++;
      steps.push({ type: 'click', text: text.substring(0, 20) });
      
      // 팝업 닫기 시도
      await page.keyboard.press('Escape');
      await wait(100);
      
    } catch (e) {
      // 클릭 실패는 무시 (가려져 있거나 등등)
    }
  }
  
  return steps;
}

/**
 * 안전하게 스크린샷을 촬영합니다.
 */
async function safeScreenshot(page, filepath, errors) {
  try {
    await page.screenshot({
      path: filepath,
      fullPage: true,
    });
  } catch (error) {
    errors.push(`스크린샷 실패 (${filepath}): ${error.message}`);
  }
}

/**
 * 지정된 시간만큼 대기합니다.
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { explorePage };
