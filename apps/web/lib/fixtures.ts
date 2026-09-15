import backtestErrorJson from "../../../contracts/backtest-error.example.json";
import backtestRequestJson from "../../../contracts/backtest-request.example.json";
import hourlyBacktestRequestJson from "../../../contracts/backtest-request-hourly.example.json";
import multiSourceBacktestRequestJson from "../../../contracts/backtest-request-multi-source.example.json";
import backtestResponseJson from "../../../contracts/backtest-response.example.json";
import hourlyBacktestResponseJson from "../../../contracts/backtest-response-hourly.example.json";
import deployResponseJson from "../../../contracts/deploy-response.example.json";
import {
  parseBacktestRequest,
  parseBacktestResponse,
  parseDeployResponse,
} from "./contracts";

export const backtestRequestFixture = parseBacktestRequest(backtestRequestJson);
export const hourlyBacktestRequestFixture = parseBacktestRequest(hourlyBacktestRequestJson);
export const multiSourceBacktestRequestFixture = parseBacktestRequest(multiSourceBacktestRequestJson);
export const backtestResponseFixture = parseBacktestResponse(backtestResponseJson);
export const hourlyBacktestResponseFixture = parseBacktestResponse(hourlyBacktestResponseJson);
export const backtestErrorFixture = parseBacktestResponse(backtestErrorJson);
export const deployResponseFixture = parseDeployResponse(deployResponseJson);
