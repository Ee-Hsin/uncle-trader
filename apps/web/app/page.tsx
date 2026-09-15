import { StrategyWorkbench } from "@/components/strategy-workbench";

export default function Home() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Uncle Trading · Hackathon starter</p>
        <h1>Describe it. Test it. Decide.</h1>
        <p className="heroCopy">
          Turn a plain-language trading idea into a confirmed strategy before any backtest or simulated deployment.
        </p>
      </header>
      <StrategyWorkbench />
    </main>
  );
}

