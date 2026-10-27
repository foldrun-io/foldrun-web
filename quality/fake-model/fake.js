var TEXT = "QUALITY-OK";
function usage() { return { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }; }
function json(r, code, o) { r.headersOut["Content-Type"] = "application/json"; r.return(code, JSON.stringify(o)); }
function ev(type, data) { data.type = type; return "event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n"; }
function answer(r) {
  var body = {};
  try { body = JSON.parse(r.requestText || "{}"); } catch (e) { return json(r, 400, { type: "error", error: { type: "invalid_request_error", message: "body is not JSON" } }); }
  var model = body.model || "fake";
  var id = "msg_fake_" + Date.now();
  if (body.stream === true) {
    r.headersOut["Content-Type"] = "text/event-stream";
    r.headersOut["Cache-Control"] = "no-cache";
    return r.return(200,
      ev("message_start", { message: { id: id, type: "message", role: "assistant", model: model, content: [], stop_reason: null, stop_sequence: null, usage: usage() } }) +
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: TEXT } }) +
      ev("content_block_stop", { index: 0 }) +
      ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }) +
      ev("message_stop", {}));
  }
  json(r, 200, { id: id, type: "message", role: "assistant", model: model, content: [{ type: "text", text: TEXT }], stop_reason: "end_turn", stop_sequence: null, usage: usage() });
}
function messages(r) { answer(r); }
function slow(r) {
  var ms = Number((r.uri.match(/^\/slow-model\/(\d+)\//) || [])[1] || 0);
  setTimeout(function () { answer(r); }, Math.min(ms, 600000));
}
function count(r) { json(r, 200, { input_tokens: 1 }); }
function models(r) { json(r, 200, { data: [], has_more: false, first_id: null, last_id: null }); }
export default { messages: messages, slow: slow, count: count, models: models };
