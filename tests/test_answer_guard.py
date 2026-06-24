from core.answer_guard import AnswerGuard


def test_after_sales_refund_and_compensation_copy_is_not_duplicated():
    result = AnswerGuard(profile={"brand": {}}).sanitize("售后问题我们包退款包赔。")

    assert result.changed is True
    assert "包退款" not in result.answer
    assert "包赔" not in result.answer
    assert result.answer == "售后问题我们会由人工客服核实后处理。"
    assert result.answer.count("会由人工客服核实后处理") == 1


def test_single_after_sales_promises_are_replaced_naturally():
    guard = AnswerGuard(profile={"brand": {}})

    refund = guard.sanitize("这个问题我们包退款。")
    compensation = guard.sanitize("这个问题我们包赔。")

    assert refund.answer == "这个问题我们会由人工客服核实后处理。"
    assert compensation.answer == "这个问题我们会由人工客服核实后处理。"
