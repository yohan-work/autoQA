import os
from datetime import datetime
from playwright.sync_api import sync_playwright, ViewportSize

class QAAutomationBot:
    def __init__(self, output_dir="qa_results"):
        self.output_dir = output_dir
        self.report_logs = []
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.result_dir = os.path.join(self.output_dir, self.timestamp)
        self.video_dir = os.path.join(self.result_dir, "videos")
        
        # 결과 저장 디렉토리 생성
        os.makedirs(self.result_dir, exist_ok=True)
        
    def log(self, message, status="INFO"):
        """로그를 기록하고 보고서용 리스트에 저장합니다."""
        log_entry = {
            "time": datetime.now().strftime("%H:%M:%S"),
            "status": status,
            "message": message
        }
        self.report_logs.append(log_entry)
        print(f"[{status}] {message}")

    def generate_html_report(self):
        """테스트 결과를 HTML 보고서로 생성합니다."""
        html_content = f"""
        <html>
        <head>
            <title>QA 자동화 보고서 - {self.timestamp}</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; }}
                h1 {{ color: #333; }}
                .summary {{ background: #f4f4f4; padding: 15px; border-radius: 5px; }}
                table {{ width: 100%; border-collapse: collapse; margin-top: 20px; }}
                th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
                th {{ background-color: #4CAF50; color: white; }}
                .INFO {{ color: #2196F3; }}
                .SUCCESS {{ color: #4CAF50; font-weight: bold; }}
                .ERROR {{ color: #f44336; font-weight: bold; }}
                .video-container {{ margin-top: 20px; }}
            </style>
        </head>
        <body>
            <h1>QA Automation Report</h1>
            <div class="summary">
                <p><strong>실행 시간:</strong> {self.timestamp}</p>
                <p><strong>저장 경로:</strong> {self.result_dir}</p>
            </div>
            
            <h2>실행 로그</h2>
            <table>
                <tr>
                    <th>시간</th>
                    <th>상태</th>
                    <th>내용</th>
                </tr>
                {"".join([f"<tr><td>{l['time']}</td><td class='{l['status']}'>{l['status']}</td><td>{l['message']}</td></tr>" for l in self.report_logs])}
            </table>

            <h2>녹화 영상</h2>
            <div class="video-container">
                <p>영상 파일은 <b>videos/</b> 폴더에 저장되었습니다.</p>
            </div>
        </body>
        </html>
        """
        
        report_path = os.path.join(self.result_dir, "report.html")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"\n[REPORT] 보고서 생성 완료: {report_path}")

    def run_test(self, target_url, actions):
        """
        자동화 테스트를 수행합니다.
        :param target_url: 접속할 URL
        :param actions: 수행할 액션 리스트 (함수 형태)
        """
        with sync_playwright() as p:
            # 브라우저 실행 (headless=False로 설정하면 브라우저 뜨는게 보임)
            browser = p.chromium.launch(headless=False)
            
            # 비디오 녹화 설정을 포함한 컨텍스트 생성
            context = browser.new_context(
                record_video_dir=self.video_dir,
                record_video_size={"width": 1280, "height": 720},
                viewport={"width": 1280, "height": 720}
            )
            
            page = context.new_page()
            
            try:
                self.log(f"테스트 시작: {target_url}")
                
                # 1. 페이지 접속
                page.goto(target_url)
                page.wait_for_load_state("networkidle") # 네트워크가 잠잠해질 때까지 대기
                self.log("페이지 접속 및 로딩 완료", "SUCCESS")

                # 사용자 정의 액션 수행
                for action in actions:
                    action(page, self)
                
                # 최종 스크린샷
                screenshot_path = os.path.join(self.result_dir, "final_screenshot.png")
                page.screenshot(path=screenshot_path)
                self.log(f"최종 스크린샷 저장: {screenshot_path}", "SUCCESS")

            except Exception as e:
                self.log(f"에러 발생: {str(e)}", "ERROR")
                # 에러 시 스크린샷
                page.screenshot(path=os.path.join(self.result_dir, "error_screenshot.png"))
            
            finally:
                # 컨텍스트 닫기 (이때 영상이 저장됨)
                context.close()
                browser.close()
                self.generate_html_report()

# ==========================================
# 사용자가 정의하는 테스트 시나리오 함수들
# ==========================================

def action_resize_test(page, bot):
    """화면 리사이즈 테스트"""
    bot.log("화면 리사이즈 테스트 시작...")
    sizes = [(1920, 1080), (768, 1024), (375, 812)] # 데스크탑, 태블릿, 모바일
    
    for width, height in sizes:
        page.set_viewport_size({"width": width, "height": height})
        bot.log(f"해상도 변경: {width}x{height}", "INFO")
        page.wait_for_timeout(1000) # 1초 대기 (시각적 확인용)
    
    # 원복
    page.set_viewport_size({"width": 1280, "height": 720})

def action_scroll_test(page, bot):
    """스크롤 테스트"""
    bot.log("스크롤 테스트 시작...")
    # 아래로 천천히 스크롤
    for i in range(5):
        page.mouse.wheel(0, 500) # 500픽셀씩 아래로
        page.wait_for_timeout(500)
    
    bot.log("페이지 하단 도달 시도", "INFO")
    # 맨 위로 이동
    page.evaluate("window.scrollTo(0, 0)")
    bot.log("스크롤 테스트 완료", "SUCCESS")

def action_type_search(page, bot):
    """검색어 타이핑 테스트 (예시: 구글/네이버 등의 검색창)"""
    # 실제 사이트에 맞는 선택자(selector)를 입력해야 합니다.
    # 예시: name='q' (구글), id='query' (네이버) 등
    # 여기서는 범용적인 input[type='text'] 또는 검색창을 찾습니다.
    
    target_selector = "input[type='text'], input[type='search'], textarea"
    
    try:
        if page.is_visible(target_selector):
            bot.log(f"입력 필드 발견 ({target_selector}), 타이핑 시도...")
            page.fill(target_selector, "자동화 테스트 중입니다.")
            page.wait_for_timeout(1000)
            bot.log("타이핑 완료", "SUCCESS")
        else:
            bot.log("입력 가능한 필드를 찾지 못했습니다 (Skip)", "INFO")
    except Exception:
        bot.log("타이핑 요소 찾기 실패", "INFO")

def action_click_buttons(page, bot):
    """버튼 클릭 테스트"""
    bot.log("버튼 클릭 테스트 시작...")
    
    # 예시: 'button' 태그나 'submit' 타입 등을 찾아서 첫 번째 것을 클릭해봄
    # 주의: 실제로 클릭하면 페이지가 이동될 수 있음
    buttons = page.locator("button, input[type='submit'], a.btn").all()
    
    if buttons:
        bot.log(f"발견된 버튼 수: {len(buttons)}개")
        # 안전을 위해 호버링만 해보거나, 첫번째 버튼만 하이라이트 해봄
        first_btn = buttons[0]
        if first_btn.is_visible():
            first_btn.hover()
            bot.log("첫 번째 버튼 호버링 성공", "SUCCESS")
            # 실제 클릭을 원하면 아래 주석 해제
            # first_btn.click() 
    else:
        bot.log("클릭할 버튼을 찾지 못했습니다.", "INFO")

# ==========================================
# 메인 실행부
# ==========================================
if __name__ == "__main__":
    # 1. 봇 인스턴스 생성
    bot = QAAutomationBot()
    
    # 2. 테스트할 대상 URL 설정
    # (테스트용으로 위키백과나 구글 등을 넣어보세요)
    TARGET_URL = "https://ko.wikipedia.org/wiki/위키백과:대문" 
    
    # 3. 수행할 액션 순서 정의
    scenario = [
        action_resize_test,
        action_scroll_test,
        action_type_search,
        action_click_buttons
    ]
    
    # 4. 테스트 실행
    bot.run_test(TARGET_URL, scenario)