/* EditFlow 2.0 self-hosted test bootstrap.
 *
 * This fixed script is invoked only by the controlled Windows self-hosted M2
 * launcher. It opens the checked-in CEP panel through After Effects' own menu
 * command API so the authenticated bridge can register without manual UI input.
 *
 * No caller-supplied script text or menu command is executed.
 */
(function () {
  "use strict";

  $.global.EditFlow2_selfHostedBridgeOpenAttempts = 0;

  $.global.EditFlow2_selfHostedOpenBridge = function () {
    var menuName = "EditFlow 2.0 Bridge";
    var maxAttempts = 120;
    var retryDelayMs = 500;
    var attempts = Number($.global.EditFlow2_selfHostedBridgeOpenAttempts || 0) + 1;
    $.global.EditFlow2_selfHostedBridgeOpenAttempts = attempts;

    try {
      var commandId = app.findMenuCommandId(menuName);
      if (typeof commandId === "number" && commandId > 0) {
        app.executeCommand(commandId);
        $.global.EditFlow2_selfHostedBridgeOpened = true;
        return;
      }
    } catch (_) {}

    if (attempts < maxAttempts) {
      app.scheduleTask("$.global.EditFlow2_selfHostedOpenBridge()", retryDelayMs, false);
    } else {
      $.global.EditFlow2_selfHostedBridgeOpenFailed = true;
    }
  };

  app.scheduleTask("$.global.EditFlow2_selfHostedOpenBridge()", 750, false);
}());
