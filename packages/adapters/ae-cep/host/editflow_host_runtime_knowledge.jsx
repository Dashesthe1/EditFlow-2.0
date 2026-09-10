/* EditFlow 2.0 read-only After Effects runtime knowledge profiler. */
(function () {
  "use strict";

  var SCHEMA_VERSION = "1.0.0";
  var PROFILER_VERSION = "1.0.0";
  var MAX_LAYERS = 64;
  var MAX_PROPERTY_DEPTH = 8;
  var MAX_PROPERTIES_PER_GROUP = 256;

  function safeString(value) {
    try {
      if (value === undefined || value === null) return null;
      return String(value);
    } catch (_) { return null; }
  }

  function safeNumber(value) {
    try {
      var number = Number(value);
      return isFinite(number) ? number : null;
    } catch (_) { return null; }
  }

  function safeBoolean(value) {
    try {
      if (value === undefined || value === null) return null;
      return Boolean(value);
    } catch (_) { return null; }
  }

  function safePrimitive(value) {
    try {
      if (value === undefined || value === null) return null;
      var kind = typeof value;
      if (kind === "string" || kind === "boolean") return value;
      if (kind === "number") return isFinite(value) ? value : null;
      return String(value);
    } catch (_) { return null; }
  }

  function pad2(value) { return value < 10 ? "0" + value : String(value); }
  function pad3(value) {
    if (value < 10) return "00" + value;
    if (value < 100) return "0" + value;
    return String(value);
  }

  function isoNow() {
    var date = new Date();
    return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate())
      + "T" + pad2(date.getUTCHours()) + ":" + pad2(date.getUTCMinutes()) + ":" + pad2(date.getUTCSeconds())
      + "." + pad3(date.getUTCMilliseconds()) + "Z";
  }

  function escapeJson(text) {
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/\"/g, "\\\"")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/[\u0000-\u001f]/g, function (character) {
        var code = character.charCodeAt(0).toString(16);
        while (code.length < 4) code = "0" + code;
        return "\\u" + code;
      });
  }

  function legacyStringify(value) {
    if (value === null || value === undefined) return "null";
    var kind = typeof value;
    if (kind === "string") return "\"" + escapeJson(value) + "\"";
    if (kind === "number") return isFinite(value) ? String(value) : "null";
    if (kind === "boolean") return value ? "true" : "false";
    if (value instanceof Array) {
      var parts = [];
      for (var i = 0; i < value.length; i += 1) parts.push(legacyStringify(value[i]));
      return "[" + parts.join(",") + "]";
    }
    var entries = [];
    for (var key in value) {
      if (value.hasOwnProperty(key) && typeof value[key] !== "function" && value[key] !== undefined) {
        entries.push("\"" + escapeJson(key) + "\":" + legacyStringify(value[key]));
      }
    }
    return "{" + entries.join(",") + "}";
  }

  function stringify(value) {
    try {
      if ($.global.EditFlow2_JSON && typeof $.global.EditFlow2_JSON.stringify === "function") {
        return $.global.EditFlow2_JSON.stringify(value);
      }
    } catch (_) {}
    try {
      if (typeof JSON !== "undefined" && JSON && typeof JSON.stringify === "function") return JSON.stringify(value);
    } catch (_) {}
    return legacyStringify(value);
  }

  function reflectionArgument(argument, index) {
    if (argument === null || argument === undefined) {
      return { name: "arg" + index, dataType: null, defaultValue: null };
    }
    if (typeof argument === "string") {
      return { name: argument, dataType: null, defaultValue: null };
    }
    return {
      name: safeString(argument.name) || ("arg" + index),
      dataType: safeString(argument.dataType),
      defaultValue: safePrimitive(argument.defaultValue)
    };
  }

  function reflectionMember(info, kind) {
    var args = [];
    try {
      if (info.arguments && info.arguments.length !== undefined) {
        for (var i = 0; i < info.arguments.length; i += 1) args.push(reflectionArgument(info.arguments[i], i));
      }
    } catch (_) {}
    return {
      name: safeString(info.name) || "",
      kind: kind,
      dataType: safeString(info.dataType),
      description: safeString(info.description),
      help: safeString(info.help),
      defaultValue: safePrimitive(info.defaultValue),
      min: safeNumber(info.min),
      max: safeNumber(info.max),
      isCollection: safeBoolean(info.isCollection),
      arguments: args
    };
  }

  function describeReflection(target) {
    try {
      if (!target || !target.reflect) return null;
      var reflection = target.reflect;
      var properties = [];
      var methods = [];
      var sourceProperties = reflection.properties || [];
      var sourceMethods = reflection.methods || [];
      var i;
      for (i = 0; i < sourceProperties.length; i += 1) properties.push(reflectionMember(sourceProperties[i], "PROPERTY"));
      for (i = 0; i < sourceMethods.length; i += 1) methods.push(reflectionMember(sourceMethods[i], "METHOD"));
      return {
        name: safeString(reflection.name) || "",
        description: safeString(reflection.description),
        help: safeString(reflection.help),
        properties: properties,
        methods: methods
      };
    } catch (_) { return null; }
  }

  function propertyTypeName(value) {
    try {
      if (typeof PropertyType !== "undefined") {
        if (value === PropertyType.PROPERTY) return "PROPERTY";
        if (value === PropertyType.INDEXED_GROUP) return "INDEXED_GROUP";
        if (value === PropertyType.NAMED_GROUP) return "NAMED_GROUP";
      }
    } catch (_) {}
    return safeString(value) || "UNKNOWN";
  }

  function propertyValueTypeName(value) {
    try {
      if (typeof PropertyValueType !== "undefined") {
        if (value === PropertyValueType.NO_VALUE) return "NO_VALUE";
        if (value === PropertyValueType.ThreeD_SPATIAL) return "THREE_D_SPATIAL";
        if (value === PropertyValueType.ThreeD) return "THREE_D";
        if (value === PropertyValueType.TwoD_SPATIAL) return "TWO_D_SPATIAL";
        if (value === PropertyValueType.TwoD) return "TWO_D";
        if (value === PropertyValueType.OneD) return "ONE_D";
        if (value === PropertyValueType.COLOR) return "COLOR";
        if (value === PropertyValueType.CUSTOM_VALUE) return "CUSTOM_VALUE";
        if (value === PropertyValueType.MARKER) return "MARKER";
        if (value === PropertyValueType.LAYER_INDEX) return "LAYER_INDEX";
        if (value === PropertyValueType.MASK_INDEX) return "MASK_INDEX";
        if (value === PropertyValueType.SHAPE) return "SHAPE";
        if (value === PropertyValueType.TEXT_DOCUMENT) return "TEXT_DOCUMENT";
      }
    } catch (_) {}
    return safeString(value);
  }

  function readBoolean(target, name) {
    try { return safeBoolean(target[name]); } catch (_) { return null; }
  }

  function readNumber(target, name) {
    try { return safeNumber(target[name]); } catch (_) { return null; }
  }

  function readString(target, name) {
    try { return safeString(target[name]); } catch (_) { return null; }
  }

  function describeProperty(property, depth, warnings, lineage) {
    var typeName = "UNKNOWN";
    try { typeName = propertyTypeName(property.propertyType); } catch (_) {}
    var node = {
      name: readString(property, "name") || "",
      matchName: readString(property, "matchName") || "",
      propertyIndex: readNumber(property, "propertyIndex") || 0,
      propertyDepth: readNumber(property, "propertyDepth") || depth,
      propertyType: typeName,
      propertyValueType: null,
      isEffect: readBoolean(property, "isEffect") === true,
      isMask: readBoolean(property, "isMask") === true,
      canSetEnabled: readBoolean(property, "canSetEnabled"),
      enabled: readBoolean(property, "enabled"),
      canSetExpression: null,
      canVaryOverTime: null,
      isSpatial: null,
      hasMin: null,
      minValue: null,
      hasMax: null,
      maxValue: null,
      unitsText: null,
      children: []
    };

    if (typeName === "PROPERTY") {
      try { node.propertyValueType = propertyValueTypeName(property.propertyValueType); } catch (_) {}
      node.canSetExpression = readBoolean(property, "canSetExpression");
      node.canVaryOverTime = readBoolean(property, "canVaryOverTime");
      node.isSpatial = readBoolean(property, "isSpatial");
      node.hasMin = readBoolean(property, "hasMin");
      node.minValue = node.hasMin === true ? readNumber(property, "minValue") : null;
      node.hasMax = readBoolean(property, "hasMax");
      node.maxValue = node.hasMax === true ? readNumber(property, "maxValue") : null;
      node.unitsText = readString(property, "unitsText");
      return node;
    }

    if (depth >= MAX_PROPERTY_DEPTH) {
      warnings.push("Property graph depth limit reached at " + lineage + "/" + (node.matchName || node.name) + ".");
      return node;
    }

    var count = 0;
    try { count = Number(property.numProperties) || 0; } catch (_) { count = 0; }
    var limited = Math.min(count, MAX_PROPERTIES_PER_GROUP);
    if (count > limited) warnings.push("Property group truncated at " + lineage + "/" + (node.matchName || node.name) + " (" + count + " -> " + limited + ").");
    for (var i = 1; i <= limited; i += 1) {
      try {
        var child = property.property(i);
        if (child) node.children.push(describeProperty(child, depth + 1, warnings, lineage + "/" + (node.matchName || node.name)));
      } catch (error) {
        warnings.push("Unable to inspect property " + i + " under " + lineage + ": " + String(error));
      }
    }
    return node;
  }

  function describeLayer(layer, warnings) {
    var className = "";
    try { className = layer.reflect && layer.reflect.name ? String(layer.reflect.name) : ""; } catch (_) {}
    var properties = [];
    var count = 0;
    try { count = Number(layer.numProperties) || 0; } catch (_) { count = 0; }
    var limited = Math.min(count, MAX_PROPERTIES_PER_GROUP);
    if (count > limited) warnings.push("Layer property root truncated for layer " + layer.index + " (" + count + " -> " + limited + ").");
    for (var i = 1; i <= limited; i += 1) {
      try {
        var property = layer.property(i);
        if (property) properties.push(describeProperty(property, 1, warnings, "layer:" + layer.index));
      } catch (error) {
        warnings.push("Unable to inspect root property " + i + " on layer " + layer.index + ": " + String(error));
      }
    }
    return {
      index: Number(layer.index) || 0,
      name: safeString(layer.name) || "",
      className: className,
      reflection: describeReflection(layer),
      properties: properties
    };
  }

  function describeActiveComposition(warnings) {
    var active = null;
    try { active = app.project ? app.project.activeItem : null; } catch (_) { active = null; }
    if (!active) return null;
    try {
      if (typeof CompItem !== "undefined" && !(active instanceof CompItem)) return null;
    } catch (_) {
      try { if (!active.layers) return null; } catch (__) { return null; }
    }

    var layerCount = 0;
    try { layerCount = Number(active.numLayers) || 0; } catch (_) { layerCount = 0; }
    var limited = Math.min(layerCount, MAX_LAYERS);
    if (layerCount > limited) warnings.push("Active composition layer scan truncated (" + layerCount + " -> " + limited + ").");
    var layers = [];
    for (var i = 1; i <= limited; i += 1) {
      try { layers.push(describeLayer(active.layer(i), warnings)); }
      catch (error) { warnings.push("Unable to inspect active composition layer " + i + ": " + String(error)); }
    }

    return {
      hostId: readNumber(active, "id"),
      name: readString(active, "name") || "",
      width: readNumber(active, "width") || 0,
      height: readNumber(active, "height") || 0,
      duration: readNumber(active, "duration") || 0,
      frameRate: readNumber(active, "frameRate") || 0,
      layerCount: layerCount,
      layers: layers
    };
  }

  function describeInstalledEffects(warnings) {
    var effects = [];
    try {
      var source = app.effects || [];
      for (var i = 0; i < source.length; i += 1) {
        var effect = source[i];
        effects.push({
          displayName: safeString(effect.displayName) || "",
          category: safeString(effect.category) || "",
          matchName: safeString(effect.matchName) || "",
          version: safeString(effect.version) || ""
        });
      }
    } catch (error) {
      warnings.push("Unable to enumerate app.effects: " + String(error));
    }
    return effects;
  }

  function capture() {
    var warnings = [];
    var project = null;
    try { project = app.project; } catch (_) { project = null; }
    var filePath = null;
    var projectName = null;
    if (project) {
      try {
        if (project.file) {
          filePath = safeString(project.file.fsName);
          projectName = safeString(project.file.name);
        }
      } catch (_) {}
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      profilerVersion: PROFILER_VERSION,
      capturedAt: isoNow(),
      source: "RUNTIME_EXTENDSCRIPT",
      host: {
        name: "Adobe After Effects",
        version: safeString(app.version) || "",
        buildName: readString(app, "buildName"),
        buildNumber: readString(app, "buildNumber"),
        locale: readString(app, "isoLanguage"),
        isRenderEngine: readBoolean(app, "isRenderEngine"),
        os: safeString($.os)
      },
      project: {
        open: project !== null,
        name: projectName,
        filePath: filePath,
        itemCount: project ? (readNumber(project, "numItems") || 0) : 0,
        revision: project ? readNumber(project, "revision") : null
      },
      applicationReflection: describeReflection(app),
      projectReflection: describeReflection(project),
      installedEffects: describeInstalledEffects(warnings),
      activeComposition: describeActiveComposition(warnings),
      warnings: warnings
    };
  }

  function writeSnapshot(path) {
    if (!path) throw new Error("Runtime knowledge output path is required.");
    var output = new File(path);
    try { output.encoding = "UTF-8"; } catch (_) {}
    if (!output.open("w")) {
      throw new Error("Unable to open runtime knowledge output. Enable 'Allow Scripts to Write Files and Access Network' in After Effects preferences.");
    }
    try { output.write(stringify(capture())); }
    finally { output.close(); }
    return output.fsName;
  }

  $.global.EditFlow2_captureAeRuntimeKnowledge = function () { return stringify(capture()); };
  $.global.EditFlow2_writeAeRuntimeKnowledge = function (path) { return writeSnapshot(path); };
  $.global.EditFlow2_AE_RUNTIME_KNOWLEDGE_SCHEMA_VERSION = SCHEMA_VERSION;
  $.global.EditFlow2_AE_RUNTIME_KNOWLEDGE_PROFILER_VERSION = PROFILER_VERSION;
}());
