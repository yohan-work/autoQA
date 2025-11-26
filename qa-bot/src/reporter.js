/**
 * reporter.js - HTML 리포트 생성 모듈
 * 
 * 이 모듈은 테스트 결과를 HTML 파일로 생성합니다.
 * 각 타겟별 상태, 에러, 스크린샷, 비디오 경로 등을 포함합니다.
 */

const fs = require('fs');
const path = require('path');

// 리포트 저장 디렉토리
const REPORTS_DIR = path.resolve(__dirname, '..', 'reports');

/**
 * HTML 특수 문자를 이스케이프합니다.
 * XSS 방지를 위해 사용합니다.
 * 
 * @param {string} text - 원본 텍스트
 * @returns {string} 이스케이프된 텍스트
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 결과에 이슈가 있는지 확인합니다.
 * 
 * @param {Object} result - 테스트 결과 객체
 * @returns {boolean} 이슈 존재 여부
 */
function hasIssues(result) {
  return !!(
    result.navigationError ||
    (result.consoleMessages && result.consoleMessages.length > 0) ||
    (result.failedRequests && result.failedRequests.length > 0) ||
    (result.exploration?.errors && result.exploration.errors.length > 0)
  );
}

/**
 * 스크린샷 목록을 HTML로 생성합니다.
 * 
 * @param {string} screenshotsDir - 스크린샷 디렉토리 (상대 경로)
 * @returns {string} 스크린샷 HTML
 */
function generateScreenshotsHtml(screenshotsDir) {
  const fullPath = path.resolve(__dirname, '..', screenshotsDir);
  
  if (!fs.existsSync(fullPath)) {
    return '<p>스크린샷 디렉토리를 찾을 수 없습니다.</p>';
  }

  const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.png'));
  
  if (files.length === 0) {
    return '<p>스크린샷이 없습니다.</p>';
  }

  // 상대 경로로 이미지 생성 (reports/ 폴더에서 artifacts/screenshots/로)
  const html = files.map(file => {
    const relativePath = `../${screenshotsDir}/${file}`;
    return `
      <div class="screenshot-item">
        <img src="${escapeHtml(relativePath)}" alt="${escapeHtml(file)}" />
        <span class="screenshot-label">${escapeHtml(file)}</span>
      </div>
    `;
  }).join('');

  return `<div class="screenshots-grid">${html}</div>`;
}

/**
 * 단일 결과에 대한 카드 HTML을 생성합니다.
 * 
 * @param {Object} result - 테스트 결과 객체
 * @param {number} index - 결과 인덱스
 * @returns {string} 카드 HTML
 */
function generateResultCard(result, index) {
  const issues = hasIssues(result);
  const statusClass = issues ? 'status-issues' : 'status-ok';
  const statusText = issues ? 'Issues Detected' : 'OK';

  // 콘솔 에러 섹션
  let consoleErrorsHtml = '';
  if (result.consoleMessages && result.consoleMessages.length > 0) {
    const errorsContent = result.consoleMessages.map(msg => 
      `<pre>${escapeHtml(msg.text)}</pre>`
    ).join('');
    consoleErrorsHtml = `
      <details class="section">
        <summary>Console Errors (${result.consoleMessages.length})</summary>
        <div class="section-content">${errorsContent}</div>
      </details>
    `;
  }

  // 실패한 요청 섹션
  let failedRequestsHtml = '';
  if (result.failedRequests && result.failedRequests.length > 0) {
    const requestsContent = result.failedRequests.map(req => 
      `<div class="request-item">
        <strong>${escapeHtml(req.method)}</strong> ${escapeHtml(req.url)}
        <br/><span class="error-text">${escapeHtml(req.failure)}</span>
      </div>`
    ).join('');
    failedRequestsHtml = `
      <details class="section">
        <summary>Failed Requests (${result.failedRequests.length})</summary>
        <div class="section-content">${requestsContent}</div>
      </details>
    `;
  }

  // 탐색 에러 섹션
  let explorationErrorsHtml = '';
  if (result.exploration?.errors && result.exploration.errors.length > 0) {
    const errorsContent = result.exploration.errors.map(err => 
      `<pre>${escapeHtml(err)}</pre>`
    ).join('');
    explorationErrorsHtml = `
      <details class="section">
        <summary>Exploration Errors (${result.exploration.errors.length})</summary>
        <div class="section-content">${errorsContent}</div>
      </details>
    `;
  }

  // 네비게이션 에러
  let navigationErrorHtml = '';
  if (result.navigationError) {
    navigationErrorHtml = `
      <div class="navigation-error">
        <strong>Navigation Error:</strong> ${escapeHtml(result.navigationError)}
      </div>
    `;
  }

  // 비디오 경로
  let videoHtml = '';
  if (result.videoPath) {
    videoHtml = `
      <div class="video-path">
        <strong>Video:</strong> <code>${escapeHtml(result.videoPath)}</code>
      </div>
    `;
  }

  // 스크린샷 섹션
  let screenshotsHtml = '';
  if (result.screenshotsDir) {
    screenshotsHtml = `
      <details class="section">
        <summary>Screenshots</summary>
        <div class="section-content">
          ${generateScreenshotsHtml(result.screenshotsDir)}
        </div>
      </details>
    `;
  }

  // Steps 섹션
  let stepsHtml = '';
  if (result.exploration?.steps && result.exploration.steps.length > 0) {
    const stepsJson = JSON.stringify(result.exploration.steps, null, 2);
    stepsHtml = `
      <details class="section">
        <summary>Steps (${result.exploration.steps.length})</summary>
        <div class="section-content">
          <pre class="steps-json">${escapeHtml(stepsJson)}</pre>
        </div>
      </details>
    `;
  }

  return `
    <div class="result-card">
      <div class="card-header">
        <h2>${escapeHtml(result.target.name)}</h2>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
      <div class="card-url">
        <a href="${escapeHtml(result.target.url)}" target="_blank">${escapeHtml(result.target.url)}</a>
      </div>
      <div class="card-meta">
        <span>Run ID: ${escapeHtml(result.runId)}</span>
      </div>
      ${navigationErrorHtml}
      ${consoleErrorsHtml}
      ${failedRequestsHtml}
      ${explorationErrorsHtml}
      ${videoHtml}
      ${screenshotsHtml}
      ${stepsHtml}
    </div>
  `;
}

/**
 * 전체 HTML 리포트를 생성합니다.
 * 
 * @param {Array} results - 테스트 결과 배열
 * @returns {Promise<string>} 생성된 리포트 파일 경로
 */
async function writeReport(results) {
  // 리포트 디렉토리 확인
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // 타임스탬프 생성 (파일명에 사용)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `report-${timestamp}.html`;
  const reportPath = path.join(REPORTS_DIR, filename);

  // 통계 계산
  const totalTargets = results.length;
  const issueCount = results.filter(r => hasIssues(r)).length;
  const okCount = totalTargets - issueCount;

  // 카드 HTML 생성
  const cardsHtml = results.map((result, index) => 
    generateResultCard(result, index)
  ).join('');

  // 전체 HTML 생성
  const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QA Automation Report - ${timestamp}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 
                   'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    header {
      background: #2c3e50;
      color: white;
      padding: 30px;
      border-radius: 8px;
      margin-bottom: 30px;
    }
    
    header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }
    
    .header-meta {
      opacity: 0.8;
      font-size: 14px;
    }
    
    .summary {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .summary-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      flex: 1;
      text-align: center;
    }
    
    .summary-card h3 {
      font-size: 14px;
      color: #666;
      margin-bottom: 5px;
    }
    
    .summary-card .number {
      font-size: 36px;
      font-weight: bold;
    }
    
    .summary-card.ok .number { color: #27ae60; }
    .summary-card.issues .number { color: #e74c3c; }
    .summary-card.total .number { color: #3498db; }
    
    .result-card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
      overflow: hidden;
    }
    
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      background: #fafafa;
      border-bottom: 1px solid #eee;
    }
    
    .card-header h2 {
      font-size: 18px;
      color: #2c3e50;
    }
    
    .status-badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
    }
    
    .status-ok {
      background: #d4edda;
      color: #155724;
    }
    
    .status-issues {
      background: #f8d7da;
      color: #721c24;
    }
    
    .card-url {
      padding: 10px 20px;
      background: #f8f9fa;
      border-bottom: 1px solid #eee;
    }
    
    .card-url a {
      color: #3498db;
      text-decoration: none;
      word-break: break-all;
    }
    
    .card-url a:hover {
      text-decoration: underline;
    }
    
    .card-meta {
      padding: 10px 20px;
      font-size: 12px;
      color: #666;
      border-bottom: 1px solid #eee;
    }
    
    .navigation-error {
      padding: 15px 20px;
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      margin: 10px 20px;
      border-radius: 4px;
    }
    
    .video-path {
      padding: 15px 20px;
      background: #e7f3ff;
      border-left: 4px solid #3498db;
      margin: 10px 20px;
      border-radius: 4px;
    }
    
    .video-path code {
      background: rgba(0,0,0,0.1);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 13px;
    }
    
    .section {
      border-top: 1px solid #eee;
    }
    
    .section summary {
      padding: 15px 20px;
      cursor: pointer;
      font-weight: 500;
      background: #fafafa;
    }
    
    .section summary:hover {
      background: #f0f0f0;
    }
    
    .section-content {
      padding: 15px 20px;
      background: white;
    }
    
    .section-content pre {
      background: #2c3e50;
      color: #ecf0f1;
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 13px;
      margin-bottom: 10px;
    }
    
    .section-content pre:last-child {
      margin-bottom: 0;
    }
    
    .request-item {
      padding: 10px;
      background: #f8f9fa;
      border-radius: 4px;
      margin-bottom: 10px;
      font-size: 13px;
    }
    
    .request-item:last-child {
      margin-bottom: 0;
    }
    
    .error-text {
      color: #e74c3c;
    }
    
    .screenshots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 15px;
    }
    
    .screenshot-item {
      background: #f8f9fa;
      border-radius: 4px;
      overflow: hidden;
      text-align: center;
    }
    
    .screenshot-item img {
      max-width: 100%;
      height: auto;
      display: block;
    }
    
    .screenshot-label {
      display: block;
      padding: 8px;
      font-size: 12px;
      color: #666;
      background: #eee;
    }
    
    .steps-json {
      max-height: 400px;
      overflow-y: auto;
    }
    
    footer {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>QA Automation Report</h1>
      <div class="header-meta">
        Generated: ${new Date().toLocaleString('ko-KR')}
      </div>
    </header>
    
    <div class="summary">
      <div class="summary-card total">
        <h3>Total Targets</h3>
        <div class="number">${totalTargets}</div>
      </div>
      <div class="summary-card ok">
        <h3>OK</h3>
        <div class="number">${okCount}</div>
      </div>
      <div class="summary-card issues">
        <h3>Issues</h3>
        <div class="number">${issueCount}</div>
      </div>
    </div>
    
    <main>
      ${cardsHtml}
    </main>
    
    <footer>
      QA Automation Bot - Powered by Playwright
    </footer>
  </div>
</body>
</html>
  `;

  // 파일 저장
  fs.writeFileSync(reportPath, html, 'utf-8');

  return reportPath;
}

module.exports = { writeReport };

