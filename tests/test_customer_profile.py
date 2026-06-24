import yaml

from core.customer_profile import business_summary, load_profile, save_profile, validate_profile
from scripts.init_customer import init_customer


def test_profile_validation_and_summary(tmp_path):
    path = tmp_path / "customer_profile.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "business": {
                    "company_name": "测试礼盒",
                    "assistant_name": "小礼",
                    "service_scope": ["礼盒定制", "LOGO 定制"],
                },
                "sales": {"quote_required_fields": ["数量"]},
                "brand": {},
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )

    profile = load_profile(str(path))
    assert validate_profile(profile) == []
    assert "测试礼盒" in business_summary(str(path))


def test_init_customer_writes_profile(tmp_path):
    path = tmp_path / "customer_profile.yaml"
    init_customer("客户公司", assistant_name="小客", hotline="400", owner="张三", path=path)

    profile = load_profile(str(path))
    assert profile["business"]["company_name"] == "客户公司"
    assert profile["business"]["assistant_name"] == "小客"
    assert profile["sales"]["hotline"] == "400"
    assert profile["sales"]["default_owner"] == "张三"


def test_save_profile_creates_backup(tmp_path):
    path = tmp_path / "customer_profile.yaml"
    save_profile(
        {
            "business": {
                "company_name": "旧公司",
                "assistant_name": "小礼",
                "service_scope": ["礼盒定制"],
            },
            "sales": {"quote_required_fields": ["数量"]},
            "brand": {},
        },
        str(path),
    )
    save_profile(
        {
            "business": {
                "company_name": "新公司",
                "assistant_name": "小客",
                "service_scope": ["礼盒定制", "包装定制"],
            },
            "sales": {"default_owner": "张三", "quote_required_fields": ["数量", "预算"]},
            "brand": {"tone": "专业"},
        },
        str(path),
    )

    profile = load_profile(str(path))
    assert profile["business"]["company_name"] == "新公司"
    assert (path.parent / "backups").exists()


def test_load_profile_treats_malformed_shapes_as_empty(tmp_path):
    path = tmp_path / "customer_profile.yaml"

    path.write_text("- broken\n", encoding="utf-8")
    assert load_profile(str(path)) == {"business": {}, "sales": {}, "brand": {}}

    path.write_text("business: [broken\n", encoding="utf-8")
    assert load_profile(str(path)) == {"business": {}, "sales": {}, "brand": {}}

    path.write_text(
        yaml.safe_dump(
            {"business": "bad", "sales": ["bad"], "brand": 123},
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    assert load_profile(str(path)) == {"business": {}, "sales": {}, "brand": {}}


def test_save_and_validate_profile_normalize_dirty_sections(tmp_path):
    path = tmp_path / "customer_profile.yaml"

    save_profile({"business": "bad", "sales": ["bad"], "brand": 123}, str(path))
    profile = load_profile(str(path))

    assert profile == {"business": {}, "sales": {}, "brand": {}}
    assert validate_profile(["bad"])
