/* EditFlow 2.0 bounded CEP panel opener.
 * Uses the exact extension menu label declared in CSXS/manifest.xml.
 * No mouse, keyboard, focus guessing, arbitrary eval, or unknown-window interaction.
 */
(function () {
  "use strict";
  var menuLabel = "EditFlow 2.0 Bridge";
  var commandId = app.findMenuCommandId(menuLabel);
  if (!commandId || commandId <= 0) throw new Error("EDITFLOW2_PANEL_MENU_COMMAND_NOT_FOUND");
  app.executeCommand(commandId);
}());
