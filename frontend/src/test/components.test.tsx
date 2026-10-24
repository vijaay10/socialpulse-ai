import { render, screen } from "@testing-library/react";
import { CacheBadge } from "../components/CacheBadge";
import { SentimentBar } from "../components/SentimentBar";
import { cacheMeta } from "./utils";

describe("CacheBadge", () => {
  it.each([
    ["hit", "Redis HIT"],
    ["miss", "MISS → MongoDB"],
    ["bypass", "BYPASS (Redis down)"],
  ] as const)("shows %s", (status, text) => {
    render(<CacheBadge cache={cacheMeta(status)} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

describe("SentimentBar", () => {
  it("labels every segment in text, not only color", () => {
    render(<SentimentBar positivePct={50} neutralPct={30} negativePct={20} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Positive 50.0%, Neutral 30.0%, Negative 20.0%");
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });
});
