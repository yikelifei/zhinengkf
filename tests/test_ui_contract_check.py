from scripts import ui_contract_check


def test_frontend_security_contract_accepts_current_renderers():
    assert ui_contract_check.frontend_security_issues() == []


def test_frontend_security_contract_flags_inner_html_renderers():
    text = """
  function setHealth(text) {
    badge.innerHTML = text;
  }
  function setSidebarStatus(status) {
    el.innerHTML = status.label;
  }
"""

    original_read = ui_contract_check._read
    try:
        ui_contract_check._read = lambda path: text
        issues = ui_contract_check.frontend_security_issues()
    finally:
        ui_contract_check._read = original_read

    assert "setHealth must render dynamic status text with text nodes, not innerHTML" in issues
    assert "setSidebarStatus must render dynamic status text with text nodes, not innerHTML" in issues
