import { Controller, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { OperatorAccessGuard, RequireOperatorCapability } from "../operator-access/operator-access.guard";

@Controller("desktop-shell")
@RequireOperatorCapability("view_console")
@UseGuards(OperatorAccessGuard)
export class DesktopShellController {
  @Post("open-zhenxi-ai")
  openZhenxiAi() {
    throw new ServiceUnavailableException({
      statusCode: 503,
      error: "Service Unavailable",
      code: "desktop_shell_interactive_launch_required",
      message: "浏览器后台不能可靠创建桌面窗口；请双击项目根目录的打开臻希AI.cmd。",
    });
  }
}
