import React, { useState } from "react";
import { Box, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { convertAnything, type ConvertResult } from "../core/convert.js";

type Mode = "menu" | "file" | "url" | "done";

interface Props {
  workspace: string;
}

export function AssimilatorTui({ workspace }: Props) {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("menu");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ConvertResult | null>(null);

  async function runConversion(kind: "file" | "url", input: string) {
    setStatus(`Converting ${input}...`);
    try {
      const converted = await convertAnything({
        workspace,
        filePath: kind === "file" ? input : undefined,
        url: kind === "url" ? input : undefined
      });
      setResult(converted);
      setStatus("Conversion complete.");
      setMode("done");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setMode("menu");
    }
  }

  if (mode === "menu") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>ASSIMILATOR</Text>
        <Text>Convert files or URLs to Markdown and HTML.</Text>
        {status ? <Text color="yellow">{status}</Text> : null}
        <SelectInput
          items={[
            { label: "Convert file", value: "file" },
            { label: "Convert URL", value: "url" },
            { label: "Quit", value: "quit" }
          ]}
          onSelect={(item) => {
            if (item.value === "quit") {
              exit();
              return;
            }
            setValue("");
            setMode(item.value as Mode);
          }}
        />
      </Box>
    );
  }

  if (mode === "file" || mode === "url") {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>{mode === "file" ? "File path" : "URL"}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(input) => void runConversion(mode, input)}
        />
        {status ? <Text color="yellow">{status}</Text> : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green" bold>{status}</Text>
      {result ? (
        <>
          <Text>Title: {result.title}</Text>
          <Text>Markdown: {result.markdownPath}</Text>
          <Text>HTML: {result.htmlPath}</Text>
        </>
      ) : null}
      <SelectInput
        items={[
          { label: "Convert another", value: "again" },
          { label: "Quit", value: "quit" }
        ]}
        onSelect={(item) => {
          if (item.value === "quit") {
            exit();
            return;
          }
          setMode("menu");
          setStatus("");
        }}
      />
    </Box>
  );
}
