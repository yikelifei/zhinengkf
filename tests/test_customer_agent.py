from core.conversation import ConversationManager
from core.customer_agent import CustomerSupportAgent


def test_agent_answers_pricing_from_skill_and_knowledge():
    agent = CustomerSupportAgent()
    decision = agent.analyze("端午礼盒多少钱，100份")

    assert decision.route == "direct_reply"
    assert decision.topic == "pricing"
    assert "数量" in decision.answer
    assert "预算" in decision.answer


def test_agent_answers_delivery_from_knowledge():
    agent = CustomerSupportAgent()
    decision = agent.analyze("什么时候能发货")

    assert decision.route == "direct_reply"
    assert decision.topic == "delivery"
    assert "5-7" in decision.answer


def test_agent_reply_style_avoids_repeating_known_fields():
    agent = CustomerSupportAgent()
    decision = agent.analyze("下周五要用，现在做来得及吗")

    assert decision.route == "direct_reply"
    assert decision.topic == "delivery"
    assert "5-7" in decision.answer
    assert "预计做多少份" in decision.answer
    assert "计划哪天使用" not in decision.answer
    assert len(decision.answer) <= 180


def test_agent_routes_complaints_to_human():
    agent = CustomerSupportAgent()
    decision = agent.analyze("我要投诉退款")

    assert decision.route == "direct_reply"
    assert decision.topic == "transfer_human"
    assert decision.answer == "已为您转接人工客服，请稍等。"


def test_agent_uses_customization_context():
    agent = CustomerSupportAgent()
    decision = agent.analyze("我们公司想做带LOGO的中秋礼盒，能不能设计")

    assert decision.route in {"direct_reply", "ai"}
    assert decision.topic == "customization"
    assert "LOGO" in (decision.answer + decision.context)


def test_agent_invoice_transfers_to_human():
    agent = CustomerSupportAgent()
    decision = agent.analyze("我要开发票，可以开专票吗")

    assert decision.route == "direct_reply"
    assert decision.topic == "transfer_human"
    assert "人工客服" in decision.answer


def test_agent_quote_qualification_asks_clarifying_question():
    agent = CustomerSupportAgent()
    decision = agent.analyze("我要做企业礼品，预算三十元")

    assert decision.route == "direct_reply"
    assert decision.topic == "quote_qualification"
    assert "数量" in decision.answer


def test_extract_lead_info_for_crm():
    manager = ConversationManager(db=None)
    info = manager.extract_contact_info(
        "我是ABC科技公司，联系人 张三，电话13812345678，预算30元，做100份，6月18日送到上海"
    )

    assert info["company_name"] == "ABC科技公司"
    assert info["contact_person"] == "张三"
    assert info["phone"] == "13812345678"
    assert info["budget"] == "30元"
    assert info["quantity_estimate"] == "100份"
    assert info["due_date"] == "6月18日"
    assert info["city"] == "上海"
