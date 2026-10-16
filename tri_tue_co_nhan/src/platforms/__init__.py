"""Khung tích hợp API đăng bài CHÍNH THỨC của từng nền tảng.

TRẠNG THÁI: CHƯA KÍCH HOẠT. Không có mô-đun nào tự đăng bài.
- Mỗi lớp chỉ kiểm tra cấu hình và mô tả các bước cần làm.
- Khi người dùng chủ động cấu hình quyền truy cập, hãy cài đặt `upload()` và chạy thử
  với chế độ riêng tư (private/draft) trước khi tuyên bố tích hợp thành công.
- Không dùng tự động hóa trình duyệt (trái điều khoản dịch vụ).
"""
from __future__ import annotations

import os


class PublisherNotConfigured(RuntimeError):
    pass


class BasePublisher:
    platform = "base"
    official_api = ""
    required_env: list[str] = []
    setup_steps: list[str] = []

    def is_configured(self) -> tuple[bool, list[str]]:
        missing = [e for e in self.required_env if not os.environ.get(e)]
        return not missing, missing

    def upload(self, video_path: str, title: str, caption: str, privacy: str = "private") -> str:
        """Phải trả về ID/URL thật do nền tảng cấp. Chưa cài đặt."""
        raise PublisherNotConfigured(
            f"Tích hợp {self.platform} chưa được cài đặt/kiểm chứng. Hãy đăng thủ công bằng gói nội dung, "
            f"hoặc dùng công cụ lên lịch chính thức. API tham khảo: {self.official_api}")


class YouTubePublisher(BasePublisher):
    platform = "youtube_shorts"
    official_api = "YouTube Data API v3 – videos.insert (OAuth 2.0)"
    required_env = ["YOUTUBE_CLIENT_SECRET_FILE"]
    setup_steps = [
        "Tạo dự án Google Cloud, bật YouTube Data API v3.",
        "Tạo OAuth client (Desktop app), tải client_secret.json, KHÔNG commit tệp này.",
        "Đặt YOUTUBE_CLIENT_SECRET_FILE trong .env, cài google-api-python-client + google-auth-oauthlib.",
        "Lưu ý hạn mức (quota) và quy định kiểm toán ứng dụng: video tải lên bởi ứng dụng chưa được kiểm "
        "toán có thể bị giới hạn ở chế độ riêng tư.",
    ]


class FacebookPublisher(BasePublisher):
    platform = "facebook_reels"
    official_api = "Meta Graph API – Page Reels publishing (/{page-id}/video_reels)"
    required_env = ["FB_PAGE_ID", "FB_PAGE_ACCESS_TOKEN"]
    setup_steps = [
        "Cần Trang Facebook (Page) và ứng dụng Meta Developer với quyền pages_manage_posts, pages_read_engagement.",
        "Tạo Page Access Token dài hạn; đặt FB_PAGE_ID và FB_PAGE_ACCESS_TOKEN trong .env.",
        "Hoặc dùng Meta Business Suite để lên lịch thủ công (khuyến nghị cho giai đoạn đầu).",
    ]


class TikTokPublisher(BasePublisher):
    platform = "tiktok"
    official_api = "TikTok Content Posting API (Direct Post / Upload as draft)"
    required_env = ["TIKTOK_CLIENT_KEY", "TIKTOK_ACCESS_TOKEN"]
    setup_steps = [
        "Đăng ký TikTok for Developers, tạo app, xin quyền video.upload / video.publish.",
        "Ứng dụng chưa qua kiểm duyệt chỉ đăng được ở chế độ riêng tư.",
        "Hoặc dùng TikTok Studio (web) để tải lên và lên lịch thủ công (khuyến nghị).",
    ]


PUBLISHERS = {p.platform: p for p in (YouTubePublisher, FacebookPublisher, TikTokPublisher)}
