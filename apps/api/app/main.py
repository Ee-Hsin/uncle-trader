from fastapi import FastAPI, status

from app.models import BacktestRequest, BacktestResponse, DeployResponse, HealthResponse

app = FastAPI(title="Uncle Trading API", version="0.1.0")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/backtest",
    response_model=BacktestResponse,
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
def backtest(request: BacktestRequest) -> BacktestResponse:
    return BacktestResponse(
        message=(
            f"Backtesting for '{request.strategy.name}' is not implemented in this starter skeleton."
        )
    )


@app.post(
    "/strategies/{strategy_id}/deploy",
    response_model=DeployResponse,
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
)
def deploy_strategy(strategy_id: str) -> DeployResponse:
    return DeployResponse(
        message="Simulated deployment is not implemented in this starter skeleton.",
        strategy_id=strategy_id,
    )

