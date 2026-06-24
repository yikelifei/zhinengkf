# -*- coding: utf-8 -*-

from datetime import datetime

from core.image_prompt_jobs import (
    ImagePromptJobQueue,
    build_image_prompt,
    create_image_prompt_job,
    extract_image_prompt_fields,
    looks_like_image_request,
)


def test_extracts_structured_fields_from_customer_requirement():
    fields = extract_image_prompt_fields(
        "帮我做一张中秋礼盒朋友圈海报，国潮高端风格，红金配色，"
        "文字写“中秋团圆礼”，需要放企业logo在右下角，尺寸1080x1920，"
        "不要卡通人物，注意突出礼盒质感。"
    )

    assert "礼盒" in fields["product_category"]
    assert "海报" in fields["product_category"]
    assert "中秋" in fields["scene"]
    assert "朋友圈" in fields["scene"]
    assert "国潮" in fields["style"]
    assert "高端" in fields["style"]
    assert "红金" in fields["colors"]
    assert fields["texts"] == ["中秋团圆礼"]
    assert fields["logo"]["required"] is True
    assert fields["size"] == "1080x1920"
    assert any("不要卡通人物" in item for item in fields["restrictions"])
    assert fields["missing_fields"] == []


def test_build_prompt_marks_unconfirmed_fields_without_inventing_assets():
    prompt = build_image_prompt(
        {
            "product_category": "海报",
            "scene": "",
            "style": [],
            "colors": [],
            "texts": [],
            "logo": {"required": None, "note": "未确认是否需要 Logo"},
            "size": "",
            "restrictions": [],
            "revision_notes": [],
        }
    )

    assert "未确认场景" in prompt
    assert "不要自行添加未确认文案" in prompt
    assert "不自造品牌标识" in prompt
    assert "不要假设任何未确认的外部 API 参数" in prompt


def test_create_job_uses_lead_context_and_stable_metadata():
    job = create_image_prompt_job(
        "客户要小红书封面，清新风格，蓝白配色，尺寸3:4。",
        lead={"id": 7, "session_id": "s1", "company_name": "测试公司", "product_category": "小红书封面"},
        now=datetime(2026, 6, 24, 10, 0, 0),
    )

    assert job["job_id"].startswith("img_")
    assert job["customer"] == "测试公司"
    assert job["session_id"] == "s1"
    assert job["created_at"] == "2026-06-24 10:00:00"
    assert job["fields"]["product_category"] == "小红书封面"
    assert job["fields"]["size"] == "3:4"
    assert "未调用真实出图软件" in job["audit_notes"][1]


def test_queue_updates_status_and_summary():
    queue = ImagePromptJobQueue()
    job = queue.add(
        "做一张端午海报，简约风格，绿色，A4，文字写端午安康。",
        lead={"session_id": "s2"},
        status="queued",
    )

    queue.update_status(job["job_id"], "in_review", note="已交给设计复核", now="2026-06-24 11:00:00")

    assert queue.get(job["job_id"])["status"] == "in_review"
    assert queue.list_jobs("in_review")[0]["job_id"] == job["job_id"]
    assert queue.summary()["total"] == 1
    assert queue.summary()["by_status"]["in_review"] == 1
    assert "已交给设计复核" in queue.get(job["job_id"])["audit_notes"]


def test_revision_notes_and_image_request_detection_are_conservative():
    fields = extract_image_prompt_fields(
        "上一版太暗了，改成黑金商务风，logo放大，去掉人物，尺寸横版。"
    )

    assert "黑金" in fields["colors"]
    assert "商务" in fields["style"]
    assert fields["size"] == "横版"
    assert any("上一版太暗了" in item for item in fields["revision_notes"])
    assert any("去掉人物" in item for item in fields["restrictions"])
    assert looks_like_image_request("客户想做一张详情页主图") is True
    assert looks_like_image_request("客户只是在问报价和发货时间") is False
