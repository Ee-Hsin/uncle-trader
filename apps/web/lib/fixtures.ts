import backtestErrorJson from "../../../contracts/backtest-error.example.json";
import backtestRequestJson from "../../../contracts/backtest-request.example.json";
import backtestResponseJson from "../../../contracts/backtest-response.example.json";
import deployResponseJson from "../../../contracts/deploy-response.example.json";
import {
  parseBacktestRequest,
  parseBacktestResponse,
  parseDeployResponse,
} from "./contracts";

export const backtestRequestFixture = parseBacktestRequest(backtestRequestJson);
export const backtestResponseFixture = parseBacktestResponse(backtestResponseJson);
export const backtestErrorFixture = parseBacktestResponse(backtestErrorJson);
export const deployResponseFixture = parseDeployResponse(deployResponseJson);
