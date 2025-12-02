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

      // 브라우저 로그 출력
      page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));

      console.log(
        `    [뷰포트 ${i + 1}/${viewportSets.length
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

    // 천천히 최상단으로 이동 (Phase 1 종료)
    console.log("    [Phase 1] 최상단으로 복귀...");
    await smoothScrollUp(page, { speed: 'slow' });
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
 * 부드럽게 페이지 끝까지 스크롤합니다. (브라우저 내부 실행)
 * @param {import('playwright').Page} page 
 * @param {Object} options
 * @param {string} options.speed - 'slow' | 'normal' | 'fast'
 */
async function smoothScrollDown(page, { speed = 'normal' } = {}) {
  // 브라우저 컨텍스트에서 스크롤 실행
  await page.evaluate(async ({ speed }) => {
    console.log('[Browser] Starting smoothScrollDown...');
    const scrollStep = 10; // 10px 단위
    const delayTime = speed === 'slow' ? 50 : 30; // 50ms or 30ms delay

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    let lastScrollY = -1;
    let sameScrollCount = 0;
    const maxSameScroll = 20; // 약 1~2초간 변화 없으면 멈춤

    while (true) {
      const currentScroll = window.scrollY;
      // document.body.scrollHeight 대신 document.documentElement.scrollHeight 사용 (더 안전)
      const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const maxScroll = totalHeight - window.innerHeight;

      console.log(`[Browser] Scroll: ${currentScroll} / ${maxScroll} (Total: ${totalHeight})`);

      // 만약 maxScroll이 0이라면, body가 아닌 내부 요소가 스크롤 영역일 수 있음
      if (maxScroll <= 0 && currentScroll === 0) {
        console.log('[Browser] Window not scrollable. Searching for scrollable container...');
        // 스크롤 가능한 가장 큰 요소 찾기
        const allElements = document.querySelectorAll('*');
        let maxScrollable = null;
        let maxScrollHeight = 0;

        for (const el of allElements) {
          const style = window.getComputedStyle(el);
          if (['scroll', 'auto'].includes(style.overflowY)) {
            if (el.scrollHeight > el.clientHeight) {
              if (el.scrollHeight > maxScrollHeight) {
                maxScrollHeight = el.scrollHeight;
                maxScrollable = el;
              }
            }
          }
        }

        if (maxScrollable) {
          console.log(`[Browser] Found scrollable container: ${maxScrollable.tagName} .${maxScrollable.className}`);
          // 해당 요소 스크롤 로직으로 전환 (여기서는 간단히 해당 요소를 끝까지 스크롤하는 루프로 변경)
          // 하지만 구조상 복잡해지므로, 일단 window 스크롤 시도 후 안되면 이 요소를 스크롤하도록 함

          const elementMaxScroll = maxScrollable.scrollHeight - maxScrollable.clientHeight;
          let elementCurrent = maxScrollable.scrollTop;

          while (elementCurrent < elementMaxScroll) {
            maxScrollable.scrollBy(0, scrollStep);
            await delay(delayTime);
            elementCurrent = maxScrollable.scrollTop;

            // 멈춤 감지 (요소)
            if (maxScrollable.scrollTop === elementCurrent && elementCurrent < elementMaxScroll) {
              // Stuck?
            }
          }
          console.log('[Browser] Container scroll finished.');
          break; // 메인 루프 종료
        } else {
          console.log('[Browser] No scrollable container found. Trying forced window scroll...');
        }
      }

      // 끝에 도달했는지 확인
      if (currentScroll >= maxScroll && maxScroll > 0) {
        console.log('[Browser] Reached bottom. Waiting to check for dynamic content...');
        // 혹시 모르니 조금 더 기다려봄 (동적 로딩)
        await delay(500);
        const newTotal = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        const newMax = newTotal - window.innerHeight;
        if (currentScroll >= newMax) {
          console.log('[Browser] Confirmed bottom. Exiting.');
          break;
        }
        console.log('[Browser] New content detected. Continuing...');
      }

      // 스크롤 실행
      window.scrollBy(0, scrollStep);
      await delay(delayTime);

      // 멈춤 감지
      if (window.scrollY === lastScrollY && maxScroll > 0) { // maxScroll > 0 일 때만 멈춤 감지
        sameScrollCount++;
        if (sameScrollCount > maxSameScroll) {
          console.log('[Browser] Stuck detected (no scroll change). Exiting.');
          break;
        }
      } else {
        sameScrollCount = 0;
      }
      lastScrollY = window.scrollY;
    }
  }, { speed });

  await wait(500);
}

/**
 * 부드럽게 페이지 맨 위로 스크롤합니다. (브라우저 내부 실행)
 * @param {import('playwright').Page} page 
 * @param {Object} options
 * @param {string} options.speed - 'slow' | 'normal' | 'fast'
 */
async function smoothScrollUp(page, { speed = 'normal' } = {}) {
  // 브라우저 컨텍스트에서 스크롤 실행
  await page.evaluate(async ({ speed }) => {
    console.log('[Browser] Starting smoothScrollUp...');
    const scrollStep = 10; // 10px 단위
    const delayTime = speed === 'slow' ? 50 : 30;

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    let lastScrollY = -1;
    let sameScrollCount = 0;
    const maxSameScroll = 20;

    while (true) {
      const currentScroll = window.scrollY;
      console.log(`[Browser] Scroll Up: ${currentScroll}`);

      // Window 스크롤이 0이면, 내부 컨테이너 스크롤 확인
      if (currentScroll <= 0) {
        window.scrollTo(0, 0);

        // 컨테이너 찾기 (Down 로직과 동일)
        console.log('[Browser] Window at top. Checking for scrollable container to scroll up...');
        const allElements = document.querySelectorAll('*');
        let maxScrollable = null;
        let maxScrollHeight = 0;

        for (const el of allElements) {
          const style = window.getComputedStyle(el);
          if (['scroll', 'auto'].includes(style.overflowY)) {
            if (el.scrollHeight > el.clientHeight) {
              if (el.scrollHeight > maxScrollHeight) {
                maxScrollHeight = el.scrollHeight;
                maxScrollable = el;
              }
            }
          }
        }

        if (maxScrollable && maxScrollable.scrollTop > 0) {
          console.log(`[Browser] Found scrollable container to scroll up: ${maxScrollable.tagName} .${maxScrollable.className}`);

          let elementCurrent = maxScrollable.scrollTop;
          while (elementCurrent > 0) {
            maxScrollable.scrollBy(0, -scrollStep);
            await delay(delayTime);
            elementCurrent = maxScrollable.scrollTop;

            if (maxScrollable.scrollTop === elementCurrent && elementCurrent > 0) {
              // Stuck?
            }
          }
          console.log('[Browser] Container scroll up finished.');
        } else {
          console.log('[Browser] No scrollable container found or already at top.');
        }

        console.log('[Browser] Reached top.');
        break;
      }

      // 스크롤 실행
      window.scrollBy(0, -scrollStep);
      await delay(delayTime);

      // 멈춤 감지
      if (window.scrollY === lastScrollY) {
        sameScrollCount++;
        if (sameScrollCount > maxSameScroll) {
          console.log('[Browser] Stuck detected during up scroll. Forcing top.');
          window.scrollTo(0, 0);
          // 여기서 break 하지 않고 컨테이너 체크로 넘어갈 수도 있지만, 
          // 일단 window가 stuck이면 컨테이너 체크 로직이 위에서 실행되므로 
          // 다음 루프에서 currentScroll <= 0 조건에 걸리게 유도하거나
          // 바로 컨테이너 체크를 수행해야 함.
          // 여기서는 break 하고 다음 호출이나 로직에 맡기기보다, 바로 위 컨테이너 체크 로직을 함수로 분리하면 좋겠지만
          // 인라인으로 처리하기 위해 continue 사용
          continue;
        }
      } else {
        sameScrollCount = 0;
      }
      lastScrollY = window.scrollY;
    }
  }, { speed });

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

  // 1. 스크롤 대상 및 정보 확인
  const scrollInfo = await page.evaluate(() => {
    const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const maxScroll = totalHeight - window.innerHeight;

    if (maxScroll > 0) {
      return { mode: 'window', scrollHeight: totalHeight, viewportHeight: window.innerHeight };
    }

    // Window 스크롤 불가 시 컨테이너 탐색
    const allElements = document.querySelectorAll('*');
    let maxScrollable = null;
    let maxScrollHeight = 0;

    for (const el of allElements) {
      const style = window.getComputedStyle(el);
      if (['scroll', 'auto'].includes(style.overflowY)) {
        if (el.scrollHeight > el.clientHeight) {
          if (el.scrollHeight > maxScrollHeight) {
            maxScrollHeight = el.scrollHeight;
            maxScrollable = el;
          }
        }
      }
    }

    if (maxScrollable) {
      // 식별을 위해 임시 클래스 추가 (이미 있으면 유지)
      if (!maxScrollable.classList.contains('qa-scroll-target')) {
        maxScrollable.classList.add('qa-scroll-target');
      }
      return {
        mode: 'container',
        selector: '.qa-scroll-target',
        scrollHeight: maxScrollable.scrollHeight,
        viewportHeight: maxScrollable.clientHeight
      };
    }

    // Fallback
    return { mode: 'window', scrollHeight: totalHeight, viewportHeight: window.innerHeight };
  });

  console.log(`[Interactive] Scroll Mode: ${scrollInfo.mode} (Height: ${scrollInfo.scrollHeight})`);

  let currentPosition = 0;
  // 인터랙션 단계는 20px 단위로 이동 (천천히)
  const stepSize = 20;

  // 이미 상호작용한 요소들을 추적하기 위한 Set (selector나 위치 기반)
  // 하지만 DOM이 변하므로 간단히 현재 뷰포트 내 요소만 처리

  while (currentPosition < scrollInfo.scrollHeight) {
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

    // 1-3. 가로 스크롤 요소 처리
    const horizontalSteps = await processHorizontalScrolls(page);
    steps.push(...horizontalSteps);

    // 2. 스크롤 이동 (smooth 제거하여 즉시 이동)
    currentPosition += stepSize;

    await page.evaluate(({ mode, selector, pos }) => {
      if (mode === 'container') {
        const el = document.querySelector(selector);
        if (el) el.scrollTo(0, pos);
      } else {
        window.scrollTo(0, pos);
      }
    }, { mode: scrollInfo.mode, selector: scrollInfo.selector, pos: currentPosition });

    // 스크롤이 잦아졌으므로 대기 시간은 짧게
    await wait(100);
  }

  // Clean up temp class
  if (scrollInfo.mode === 'container') {
    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (el) el.classList.remove('qa-scroll-target');
    }, scrollInfo.selector);
  }

  return steps;
}

/**
 * 현재 뷰포트 내의 가로 스크롤 가능한 요소를 찾아 스크롤합니다.
 * @param {import('playwright').Page} page 
 */
async function processHorizontalScrolls(page) {
  const steps = [];

  try {
    // 가로 스크롤이 가능한 요소 찾기 및 스크롤 실행
    const scrolledCount = await page.evaluate(async () => {
      let count = 0;
      // 셀렉터 확장 및 구체화
      const elements = document.querySelectorAll('div, ul, nav, section, article, [class*="filter"], [class*="nav"]');

      console.log(`[Horizontal] Checking ${elements.length} elements for horizontal scroll...`);

      for (const el of elements) {
        if (el.dataset.qaScrolled) continue;

        // 1. Scroll Width 체크
        const isScrollableWidth = el.scrollWidth > el.clientWidth + 5; // 5px로 완화

        // 2. Style 체크 (overflow-x)
        const style = window.getComputedStyle(el);
        const isScrollableStyle = ['auto', 'scroll'].includes(style.overflowX);

        // 조건: 내용이 넘치거나, 스타일이 스크롤 가능하게 설정되어 있고 실제로 조금이라도 넘칠 때
        if (isScrollableWidth || (isScrollableStyle && el.scrollWidth > el.clientWidth)) {

          // 화면에 보이는지 확인
          const rect = el.getBoundingClientRect();
          // 높이가 0이 아니고, 화면 내에 조금이라도 들어와 있으면
          const isVisible = rect.height > 0 &&
            rect.top < window.innerHeight && rect.bottom > 0;

          if (isVisible) {
            console.log(`[Horizontal] Found scrollable element: ${el.tagName} .${el.className}`);

            // 스크롤 실행
            const originalLeft = el.scrollLeft;

            // 오른쪽으로 이동
            el.scrollBy({ left: 200, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 500)); // 시간 늘림

            // 이동했는지 확인 (실제로 스크롤이 되었는지)
            if (el.scrollLeft === originalLeft) {
              console.log(`[Horizontal] Element did not scroll. Skipping.`);
              continue;
            }

            // 다시 원복
            el.scrollBy({ left: -200, behavior: 'smooth' });
            await new Promise(r => setTimeout(r, 500));

            el.dataset.qaScrolled = 'true';
            count++;
          }
        }
      }
      return count;
    });

    if (scrolledCount > 0) {
      console.log(`    [Horizontal] ${scrolledCount}개 요소 가로 스크롤 완료`);
      steps.push({ type: 'horizontal-scroll', count: scrolledCount });
      await wait(500);
    }

  } catch (e) {
    console.log(`    [Horizontal] 스크롤 처리 중 오류: ${e.message}`);
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

      // 팝업 처리 (닫기 버튼 찾기 -> 없으면 ESC)
      await handlePotentialPopup(page);

    } catch (e) {
      // 클릭 실패는 무시 (가려져 있거나 등등)
    }
  }

  return steps;
}

/**
 * 팝업이 떴을 가능성이 있을 때 처리합니다.
 * 1. 명시적인 닫기 버튼(X, 닫기 등)을 찾아 클릭 시도
 * 2. 실패 시 ESC 키 입력
 * 
 * @param {import('playwright').Page} page 
 */
async function handlePotentialPopup(page) {
  // 팝업 렌더링 및 사용자 확인을 위한 대기 (2.5초)
  await wait(2500);

  // 닫기 버튼으로 추정되는 셀렉터들
  const closeSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label="닫기"]',
    'button[aria-label="close"]',
    '.close',
    '.btn-close',
    '.popup-close',
    '.modal-close',
    '[class*="close"]', // 클래스명에 close가 포함된 요소 (조심해서 사용)
    'button:has-text("닫기")',
    'button:has-text("Close")',
    'button:has-text("취소")',
    'button:has-text("X")',
  ];

  const dimmedSelectors = [
    '.modal-backdrop',
    '.dimmed',
    '.overlay',
    '.popup-mask',
    '[class*="backdrop"]',
    '[class*="dimmed"]',
    '[class*="mask"]',
    '[class*="overlay"]'
  ];

  try {
    // 1. 명시적인 닫기 버튼 찾기
    // 현재 뷰포트 내에 있고, visible한 닫기 버튼을 찾음
    for (const selector of closeSelectors) {
      const closeBtn = page.locator(`${selector}:visible`).first();

      if (await closeBtn.count() > 0) {
        console.log(`    [Popup] 닫기 버튼 발견: ${selector}`);
        await closeBtn.click({ timeout: 1000 });
        await wait(200); // 닫힘 대기
        return; // 성공적으로 닫았으면 종료
      }
    }

    // 2. Dimmed 영역 클릭 시도
    for (const selector of dimmedSelectors) {
      // dimmed는 보통 화면 전체를 덮으므로 visible 체크
      const dimmed = page.locator(`${selector}:visible`).first();
      if (await dimmed.count() > 0) {
        console.log(`    [Popup] Dimmed 영역 발견: ${selector}`);
        // 중앙 클릭 시 팝업 컨텐츠를 클릭할 수도 있으므로, 
        // 보통 dimmed는 z-index가 팝업보다 낮지만, 클릭 이벤트가 전달되려면 
        // 팝업 밖을 클릭해야 함. 
        // Playwright click은 요소의 중앙을 클릭함.
        // Dimmed 요소가 전체 화면이라면 (0,0)이나 구석을 클릭하는게 안전할 수 있음.
        // 하지만 여기서는 force: true로 해당 요소 클릭 시도
        await dimmed.click({ position: { x: 10, y: 10 }, force: true, timeout: 1000 });
        await wait(200);
        return;
      }
    }

  } catch (e) {
    // 클릭 실패 시 무시하고 ESC 시도
    console.log(`    [Popup] 닫기/Dimmed 클릭 실패: ${e.message}`);
  }

  // 3. Fallback: ESC 키
  await page.keyboard.press('Escape');
  await wait(100);
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
