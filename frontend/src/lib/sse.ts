export type ServerEvent = { event: string; data: unknown };

/** Incremental parser for a text/event-stream body: feed decoded chunks, get complete events back. */
export function createEventParser() {
  let buffer = "";
  return (chunk: string): ServerEvent[] => {
    buffer += chunk.replace(/\r\n/g, "\n");
    const events: ServerEvent[] = [];
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) {
        try {
          events.push({ event, data: JSON.parse(data.join("\n")) });
        } catch {
          events.push({ event, data: data.join("\n") });
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
    return events;
  };
}
