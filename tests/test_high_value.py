from core.high_value import (
    amount_from_text,
    estimate_deal_value,
    evaluate_lead,
    quantity_from_text,
)


def test_evaluate_lead_tolerates_dirty_rule_values():
    assessment = evaluate_lead(
        {
            "stage": "new_inquiry",
            "lead_score": "bad",
        },
        {
            "high_value_min_score": "bad",
            "high_value_min_deal_value": "bad",
            "high_value_excluded_stages": "lost",
            "required_fields": "bad",
        },
    )

    assert assessment["is_high_value"] is False
    assert assessment["lead_score"] == 0
    assert "phone_or_wechat" in assessment["missing_fields"]
    assert "quantity_estimate" in assessment["missing_fields"]


def test_evaluate_lead_falls_back_to_default_threshold_when_rule_is_dirty():
    assessment = evaluate_lead(
        {
            "stage": "new_inquiry",
            "lead_score": 80,
            "phone": "13812345678",
        },
        {"high_value_min_score": "bad", "required_fields": "bad"},
    )

    assert assessment["is_high_value"] is True
    assert assessment["lead_score"] == 80


def test_estimates_deal_value_from_quantity_and_unit_budget():
    value, source = estimate_deal_value(
        {
            "quantity_estimate": "500份",
            "budget": "30元/份",
        }
    )

    assert value == 15000
    assert source == "quantity_x_budget"


def test_high_value_by_estimated_deal_value_even_when_score_is_medium():
    assessment = evaluate_lead(
        {
            "stage": "new_inquiry",
            "lead_score": 55,
            "phone": "13812345678",
            "quantity_estimate": "500份",
            "budget": "30元/份",
        },
        {"high_value_min_score": 80, "high_value_min_deal_value": 10000},
    )

    assert assessment["is_high_value"] is True
    assert assessment["estimated_deal_value"] == 15000
    assert "预计金额 1.5万元 达到阈值 1万元" in assessment["reasons"]


def test_high_score_lead_is_high_value_without_full_fields():
    assessment = evaluate_lead(
        {
            "stage": "info_collected",
            "lead_score": 88,
            "wechat_id": "customer_001",
        },
        {"high_value_min_score": 80, "high_value_min_deal_value": 10000},
    )

    assert assessment["is_high_value"] is True
    assert "quantity_estimate" in assessment["missing_fields"]


def test_high_value_rules_tolerate_malformed_values():
    assessment = evaluate_lead(
        {
            "lead_score": "bad",
            "stage": "quotation_given",
            "phone": "13800138000",
            "budget": "12000",
        },
        {
            "high_value_min_score": "bad",
            "high_value_min_deal_value": "bad",
            "high_value_excluded_stages": "lost",
            "required_fields": "phone_or_wechat",
        },
    )

    assert assessment["lead_score"] == 0
    assert assessment["is_high_value"] is True
    assert "phone_or_wechat" not in assessment["missing_fields"]


def test_excluded_stage_is_not_high_value():
    assessment = evaluate_lead(
        {
            "stage": "lost",
            "lead_score": 95,
            "quantity_estimate": "1000份",
            "budget": "50元/份",
        },
        {"high_value_min_score": 80, "high_value_min_deal_value": 10000},
    )

    assert assessment["is_high_value"] is False
    assert "已排除阶段" in assessment["reasons"]


def test_amount_and_quantity_parsers_handle_ranges_and_wan():
    assert amount_from_text("预算1.2万左右") == 12000
    assert amount_from_text("30-50元/份") == 50
    assert quantity_from_text("100-200份") == 200
