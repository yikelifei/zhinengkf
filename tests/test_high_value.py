from core.high_value import (
    amount_from_text,
    estimate_deal_value,
    evaluate_lead,
    quantity_from_text,
)


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
