import { SignInButton, UserButton, useUser } from "@clerk/tanstack-react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import {
	Area,
	CartesianGrid,
	ComposedChart,
	Line,
	Tooltip as RechartsTooltip,
	ReferenceLine,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "../components/ui/tooltip";
import {
	getDashboardData,
	pollTadoReconnect,
	startTadoReconnect,
} from "../window-watcher/functions";
import { getSparklineAreaStops } from "../window-watcher/sparkline";
import type {
	DashboardData,
	RoomReading,
	TemperatureHistoryEntry,
} from "../window-watcher/types";

const rangeModes = ["4h", "16h", "24h", "48h", "week"] as const;
type RangeMode = (typeof rangeModes)[number];
const dashboardSearchSchema = z.object({
	range: z.enum(rangeModes).optional().catch(undefined),
});

export const Route = createFileRoute("/")({
	validateSearch: dashboardSearchSchema,
	component: App,
});

const roomColors = ["#ff7a59", "#9c8cff", "#ffb454", "#4cc9f0", "#ff6fa0"];
const outsideColor = "#2dd4bf";
const outsideForecastColor = "#f2b953";
const mainChartCurveType = "basis";
const sparklineCurveType = mainChartCurveType;
const measurementProgressRecalculationMs = 5 * 1000;
const appVersionCheckIntervalMs = 60 * 1000;
const authEnabled = import.meta.env.VITE_WINDOW_WATCHER_AUTH === "true";
const localReconnectEnabled = import.meta.env.DEV;

function App() {
	useAppVersionReload();

	return (
		<TooltipProvider>
			{authEnabled ? (
				<AuthenticatedApp />
			) : (
				<DashboardQuery authEnabled={false} />
			)}
		</TooltipProvider>
	);
}

function AuthenticatedApp() {
	const { isLoaded, isSignedIn } = useUser();

	if (!isLoaded) {
		return (
			<main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 sm:px-6">
				<LoadingPanel />
			</main>
		);
	}

	if (!isSignedIn) return <AuthGate />;
	return <DashboardQuery authEnabled={true} />;
}

function DashboardQuery({ authEnabled }: { authEnabled: boolean }) {
	const { range } = Route.useSearch();
	const navigate = Route.useNavigate();
	const rangeMode = range ?? "4h";
	const setRangeMode = (mode: RangeMode) => {
		void navigate({
			replace: true,
			search: (previous) => ({
				...previous,
				range: mode === "4h" ? undefined : mode,
			}),
		});
	};
	const dashboard = useQuery({
		queryKey: ["window-watcher-dashboard"],
		queryFn: () => getDashboardData(),
		refetchInterval: 60_000,
	});

	if (dashboard.isLoading) {
		return (
			<main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 sm:px-6">
				<LoadingPanel />
			</main>
		);
	}

	if (
		authEnabled &&
		dashboard.error instanceof Error &&
		dashboard.error.message.includes("Sign in with Google")
	) {
		return <AuthGate />;
	}

	if (dashboard.isError || !dashboard.data) {
		return (
			<main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 sm:px-6">
				<Card className="surface-panel w-full max-w-xl gap-4 py-6">
					<CardHeader>
						<CardTitle asChild>
							<h1 className="text-2xl font-semibold text-[var(--ww-ember)]">
								Window Watcher could not load
							</h1>
						</CardTitle>
						<CardDescription className="text-[var(--ww-ink-soft)]">
							{dashboard.error instanceof Error
								? dashboard.error.message
								: "Could not load temperatures."}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button onClick={() => void dashboard.refetch()} type="button">
							Try again
						</Button>
					</CardContent>
				</Card>
			</main>
		);
	}

	return (
		<Dashboard
			authEnabled={authEnabled}
			data={dashboard.data}
			isRefreshing={dashboard.isFetching}
			rangeMode={rangeMode}
			setRangeMode={setRangeMode}
		/>
	);
}

function LoadingPanel() {
	return (
		<Card
			aria-busy="true"
			aria-live="polite"
			className="surface-panel w-full max-w-xl gap-3 py-6"
		>
			<p className="sr-only">
				Loading current temperatures and recommendations.
			</p>
			<CardHeader>
				<Skeleton className="h-4 w-32 rounded-sm" />
				<Skeleton className="h-9 w-64 max-w-full rounded-md" />
			</CardHeader>
			<CardContent className="grid gap-3">
				<Skeleton className="h-3.5 w-full rounded-sm" />
				<Skeleton className="h-24 w-full rounded-md" />
			</CardContent>
		</Card>
	);
}

function isRangeMode(value: string): value is RangeMode {
	return rangeModes.some((mode) => mode === value);
}

function AuthGate() {
	return (
		<main className="relative mx-auto flex min-h-screen max-w-2xl items-center px-4 text-[var(--ww-ink)] sm:px-6">
			<Card className="surface-panel w-full gap-4 py-8">
				<CardHeader>
					<p className="text-sm font-semibold text-[var(--ww-ink-soft)]">
						Window Watcher
					</p>
					<CardTitle asChild>
						<h1 className="mt-1 text-3xl font-semibold text-[var(--ww-ink)]">
							Sign in to view your rooms
						</h1>
					</CardTitle>
					<CardDescription className="mt-1 text-base leading-6 text-[var(--ww-ink-soft)]">
						Sign in with the authorized Google account to view live temperatures
						and window recommendations.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<SignInButton mode="modal">
						<Button size="lg" type="button">
							Sign in with Google
						</Button>
					</SignInButton>
				</CardContent>
			</Card>
		</main>
	);
}

function useAppVersionReload() {
	useEffect(() => {
		if (!import.meta.env.PROD) return;

		let active = true;
		let currentVersion: string | null = null;
		let reloading = false;

		async function checkVersion() {
			try {
				const response = await fetch("/app-version.json", {
					cache: "no-store",
				});
				if (!active || !response.ok) return;

				const payload = (await response.json()) as { version?: unknown };
				const nextVersion =
					typeof payload.version === "string" ? payload.version : null;
				if (!nextVersion) return;

				if (currentVersion && nextVersion !== currentVersion && !reloading) {
					reloading = true;
					window.location.reload();
					return;
				}

				currentVersion = nextVersion;
			} catch {
				// Version checks should never interrupt the dashboard.
			}
		}

		const check = () => {
			void checkVersion();
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") check();
		};

		check();
		const interval = window.setInterval(check, appVersionCheckIntervalMs);
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			active = false;
			window.clearInterval(interval);
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);
}

function useCurrentTime(initialIso: string, intervalMs: number) {
	const [currentTime, setCurrentTime] = useState(() => new Date(initialIso));

	useEffect(() => {
		const tick = () => {
			setCurrentTime(new Date());
		};

		tick();
		const interval = window.setInterval(tick, intervalMs);
		return () => window.clearInterval(interval);
	}, [intervalMs]);

	return currentTime;
}

function Dashboard({
	authEnabled,
	data,
	isRefreshing,
	rangeMode,
	setRangeMode,
}: {
	authEnabled: boolean;
	data: DashboardData;
	isRefreshing: boolean;
	rangeMode: RangeMode;
	setRangeMode: (mode: RangeMode) => void;
}) {
	const { status, history } = data;
	const [activeChartLineKey, setActiveChartLineKey] = useState<string | null>(
		null,
	);
	const measurementReferenceAt = useCurrentTime(
		data.generatedAt,
		measurementProgressRecalculationMs,
	);
	const measurementAt = new Date(status.lastFreshAt || status.checkedAt);
	const recommendationPrediction = status.recommendation.prediction;
	const measurementAge = formatMeasurementAge(
		measurementAt,
		measurementReferenceAt,
	);
	const isMeasurementStale = status.stale || measurementAge.minutes >= 30;
	const filteredHistory = useMemo(
		() => filterHistory(history, rangeMode),
		[history, rangeMode],
	);
	const chartRows = useMemo(
		() => buildChartRows(filteredHistory, status.rooms, status),
		[filteredHistory, status],
	);
	const xAxisTicks = useMemo(
		() => buildXAxisTicks(chartRows, rangeMode),
		[chartRows, rangeMode],
	);
	const midnightMarkers = useMemo(
		() => buildMidnightMarkers(chartRows),
		[chartRows],
	);
	const chartScale = useMemo(
		() => buildTemperatureScale(chartRows, status.rooms),
		[chartRows, status.rooms],
	);
	const legendItems = useMemo(
		() => buildLegendItems(chartRows, status.rooms),
		[chartRows, status.rooms],
	);
	const hasChartData = legendItems.length > 0;
	const nextAvailableRange = findNextAvailableRange(history, rangeMode);
	const hasOutdoorTrend =
		status.recommendation.outdoorTrend.sampleCount >= 2 &&
		status.recommendation.outdoorTrend.hours >= 0.25;
	const handleRangeModeChange = (mode: RangeMode) => {
		setActiveChartLineKey(null);
		setRangeMode(mode);
	};

	return (
		<main className="mx-auto min-h-screen max-w-[65rem] px-4 py-4 text-[var(--ww-ink)] sm:px-6 sm:py-8">
			<p aria-live="polite" className="sr-only">
				{isRefreshing
					? "Refreshing temperatures."
					: isMeasurementStale
						? "Showing saved temperatures."
						: "Refresh complete."}
			</p>
			<section className={`status-panel ${status.verdict.action}`}>
				<div className="flex flex-col gap-6">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-3">
								<p className="text-base font-semibold text-[var(--ww-ink)]">
									Window Watcher
								</p>
								{authEnabled ? <UserButton /> : null}
							</div>
							<p className="mt-1.5 flex max-w-4xl flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--ww-ink-soft)]">
								<span>{status.location.label}</span>
								<span aria-hidden="true" className="text-[var(--ww-ink-faint)]">
									·
								</span>
								<span>Last room reading {measurementAge.label}</span>
							</p>
						</div>
						<div className="text-right">
							<p className="data-label">Outside now</p>
							<p className="mono-num mt-1 text-3xl font-semibold text-[var(--ww-ink)] sm:text-4xl">
								{formatTemp(status.outside.temperatureC)}
							</p>
						</div>
					</div>

					<div>
						<h1 className="verdict-title text-[1.75rem] leading-tight font-semibold sm:text-4xl">
							{status.verdict.title}
						</h1>
						<p className="mt-2 max-w-2xl text-base text-[var(--ww-ink-soft)]">
							{status.verdict.detail}
						</p>
					</div>

					<ThermalGauge
						forecastMinC={
							status.recommendation.forecast?.minTemperatureC ?? null
						}
						outsideC={status.outside.temperatureC}
						referenceRoomName={
							recommendationPrediction?.referenceZoneName ??
							status.tado.referenceZoneName ??
							"the reference room"
						}
						horizonMinutes={recommendationPrediction?.horizonMinutes}
						thresholdC={status.recommendation.thresholdC}
					/>

					<div className="data-grid">
						<div className="data-cell">
							<p className="data-label">Last room reading</p>
							<p className="mt-1 text-sm font-semibold text-[var(--ww-ink)]">
								{formatDateTime(measurementAt)}
							</p>
						</div>
						{hasOutdoorTrend ? (
							<div className="data-cell">
								<p className="data-label">Outdoor trend</p>
								<p className="mt-0.5 text-sm font-semibold text-[var(--ww-ink)]">
									{status.recommendation.outdoorTrend.direction} ·{" "}
									{formatDelta(status.recommendation.outdoorTrend.changeC)} over{" "}
									{status.recommendation.outdoorTrend.hours.toFixed(1)}h
								</p>
							</div>
						) : null}
						{status.recommendation.forecast?.minTemperatureC == null ? null : (
							<div className="data-cell">
								<p className="data-label">
									Next {status.recommendation.forecast.horizonHours.toFixed(0)}h
									low
								</p>
								<p className="mono-num mt-0.5 text-sm font-semibold text-[var(--ww-ink)]">
									{formatTemp(status.recommendation.forecast.minTemperatureC)}
								</p>
							</div>
						)}
						{recommendationPrediction ? (
							<div className="data-cell">
								<p className="data-label">
									{recommendationPrediction.horizonMinutes}m prediction
								</p>
								<p className="mono-num mt-0.5 text-sm font-semibold text-[var(--ww-ink)]">
									{formatTemp(
										recommendationPrediction.predictedOpenTemperatureC,
									)}{" "}
									open ·{" "}
									{formatTemp(
										recommendationPrediction.predictedClosedTemperatureC,
									)}{" "}
									closed
								</p>
							</div>
						) : null}
						{recommendationPrediction ? (
							<div className="data-cell">
								<p className="data-label">Rebound risk</p>
								<p className="mono-num mt-0.5 text-sm font-semibold text-[var(--ww-ink)]">
									{formatDelta(recommendationPrediction.expectedReboundC)} ·
									mass {formatTemp(recommendationPrediction.massTemperatureC)}
								</p>
							</div>
						) : null}
					</div>

					{status.recommendation.forecast?.summary ? (
						<p className="-mt-3 text-sm font-semibold text-[var(--ww-ink-soft)]">
							{status.recommendation.forecast.summary}
						</p>
					) : null}
					{isMeasurementStale ? (
						<Alert className="border-[var(--ww-gold)] bg-[var(--ww-gold-soft)]">
							<AlertTitle className="text-[var(--ww-ink)]">
								Room readings are{" "}
								{formatMeasurementAgeLong(measurementAge.minutes)}
							</AlertTitle>
							<AlertDescription className="text-[var(--ww-ink-soft)]">
								<p>This recommendation may no longer be accurate.</p>
								{status.stale ? (
									<p>{formatStaleReason(status.staleReason)}</p>
								) : null}
							</AlertDescription>
						</Alert>
					) : null}
					{localReconnectEnabled && shouldShowTadoReconnect(status) ? (
						<TadoReconnectPanel />
					) : null}
				</div>
			</section>

			<Card className="surface-panel mt-5 gap-0 overflow-hidden py-0">
				<CardHeader className="mb-2 flex flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-0 sm:flex-row sm:px-6">
					<div>
						<CardTitle asChild>
							<h2 className="text-xl font-semibold text-[var(--ww-ink)] sm:text-2xl">
								Temperature trends
							</h2>
						</CardTitle>
						<CardDescription className="mt-1 text-sm text-[var(--ww-ink-soft)]">
							{formatRangeLabel(rangeMode)} · {filteredHistory.length}{" "}
							{filteredHistory.length === 1 ? "measurement" : "measurements"}
						</CardDescription>
					</div>
					<CardAction className="static col-auto row-auto w-full self-auto justify-self-auto sm:w-auto">
						<ToggleGroup
							aria-label="History range"
							className="range-scroll flex w-full overflow-x-auto rounded-md border border-[var(--ww-hairline-strong)] bg-[var(--md-sys-color-surface-container-low)] p-1 sm:w-auto"
							onValueChange={(value) => {
								if (isRangeMode(value)) handleRangeModeChange(value);
							}}
							size="sm"
							type="single"
							value={rangeMode}
							variant="default"
						>
							{rangeModes.map((mode) => (
								<ToggleGroupItem
									key={mode}
									value={mode}
									className="min-h-12 rounded-sm px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-none"
								>
									{mode === "week" ? "Week" : mode}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</CardAction>
				</CardHeader>
				<CardContent className="px-4 pb-5 sm:px-6">
					{hasChartData ? (
						<>
							<div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
								{legendItems.map((item) => (
									<div
										className="flex items-center gap-2 text-xs font-semibold text-[var(--ww-ink-soft)]"
										key={item.label}
									>
										<span
											className="size-2.5 rounded-full"
											style={{ backgroundColor: item.color }}
										/>
										{item.label}
									</div>
								))}
							</div>
							<div
								aria-label={buildChartAriaLabel(
									chartRows,
									legendItems,
									rangeMode,
								)}
								className="h-[18rem] w-full sm:h-[22rem]"
								role="img"
							>
								<ResponsiveContainer height="100%" width="100%">
									<ComposedChart
										accessibilityLayer={false}
										data={chartRows}
										margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
										onMouseLeave={() => setActiveChartLineKey(null)}
										onMouseMove={(nextState) => {
											setActiveChartLineKey(
												nextState.activeDataKey == null
													? null
													: String(nextState.activeDataKey),
											);
										}}
									>
										<CartesianGrid
											stroke="var(--ww-hairline)"
											vertical={false}
										/>
										<XAxis
											dataKey="timestamp"
											domain={["dataMin", "dataMax"]}
											minTickGap={rangeMode === "week" ? 56 : 32}
											scale="time"
											tick={{
												fill: "var(--ww-ink-faint)",
												fontSize: 11,
												fontFamily: "var(--font-mono)",
											}}
											tickFormatter={(value) =>
												formatChartTick(Number(value), rangeMode)
											}
											tickLine={false}
											ticks={xAxisTicks}
											type="number"
										/>
										{midnightMarkers.map((marker) => (
											<ReferenceLine
												ifOverflow="extendDomain"
												key={marker}
												stroke="var(--ww-hairline-strong)"
												strokeDasharray="3 5"
												x={marker}
											/>
										))}
										<YAxis
											domain={[chartScale.min, chartScale.max]}
											tick={{
												fill: "var(--ww-ink-faint)",
												fontSize: 11,
												fontFamily: "var(--font-mono)",
											}}
											tickFormatter={(value) => `${value}°`}
											tickLine={false}
											ticks={chartScale.ticks}
											width={40}
										/>
										<RechartsTooltip
											content={<ChartTooltip />}
											cursor={
												<ChartCrosshairCursor
													activeDataKey={activeChartLineKey}
													yMax={chartScale.max}
													yMin={chartScale.min}
												/>
											}
										/>
										<Line
											connectNulls
											dataKey="outside"
											dot={false}
											name="Outside"
											stroke={outsideColor}
											strokeWidth={2.75}
											type={mainChartCurveType}
										/>
										<Line
											connectNulls
											dataKey="outsideForecast"
											dot={false}
											name="2h forecast"
											stroke={outsideForecastColor}
											strokeDasharray="5 5"
											strokeWidth={2.25}
											type="monotone"
										/>
										{status.rooms.map((room, index) => (
											<Line
												connectNulls
												dataKey={`room-${room.zoneId}`}
												dot={false}
												key={room.zoneId}
												name={room.zoneName}
												stroke={roomColors[index % roomColors.length]}
												strokeWidth={2.25}
												type={mainChartCurveType}
											/>
										))}
									</ComposedChart>
								</ResponsiveContainer>
							</div>
						</>
					) : (
						<div className="empty-state" role="status">
							<h3 className="text-base font-semibold text-[var(--ww-ink)]">
								No saved readings in {formatRangeLabel(rangeMode).toLowerCase()}
							</h3>
							<p className="mt-1 max-w-lg text-sm leading-6 text-[var(--ww-ink-soft)]">
								New readings will appear here after the next successful sample.
							</p>
							{nextAvailableRange ? (
								<Button
									className="mt-4"
									onClick={() => handleRangeModeChange(nextAvailableRange)}
									type="button"
									variant="outline"
								>
									Show {formatRangeLabel(nextAvailableRange).toLowerCase()}
								</Button>
							) : null}
						</div>
					)}
				</CardContent>
			</Card>

			<Card className="surface-panel mt-5 gap-0 py-0">
				<CardHeader className="mb-2 flex flex-row items-center justify-between px-4 pt-5 pb-0 sm:px-6">
					<CardTitle asChild>
						<h2 className="text-xl font-semibold text-[var(--ww-ink)] sm:text-2xl">
							Rooms
						</h2>
					</CardTitle>
					<CardDescription className="text-sm text-[var(--ww-ink-soft)]">
						{status.rooms.length} {status.rooms.length === 1 ? "room" : "rooms"}
					</CardDescription>
				</CardHeader>
				<CardContent className="px-4 pb-5 sm:px-6">
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{status.rooms.map((room) => (
							<RoomCard history={history} key={room.zoneId} room={room} />
						))}
					</div>
				</CardContent>
			</Card>
			<footer className="px-1 py-6 text-xs text-[var(--ww-ink-faint)]">
				Refreshes every minute while this page is open.
			</footer>
		</main>
	);
}

function ThermalGauge({
	forecastMinC,
	horizonMinutes,
	outsideC,
	referenceRoomName,
	thresholdC,
}: {
	forecastMinC: number | null;
	horizonMinutes?: number;
	outsideC: number;
	referenceRoomName: string;
	thresholdC: number;
}) {
	const knownValues = [outsideC, thresholdC];
	if (forecastMinC != null) knownValues.push(forecastMinC);

	const rawMin = Math.min(...knownValues);
	const rawMax = Math.max(...knownValues);
	const padding = Math.max(1.4, (rawMax - rawMin) * 0.4);
	const scaleMin = rawMin - padding;
	const scaleMax = rawMax + padding;
	const toPercent = (value: number) =>
		Math.min(
			100,
			Math.max(0, ((value - scaleMin) / (scaleMax - scaleMin)) * 100),
		);

	return (
		<div
			aria-label={`Outside is ${formatTemp(outsideC)}. Open-window cooling becomes useful at or below ${formatTemp(thresholdC)}, based on ${referenceRoomName}${horizonMinutes ? ` over ${horizonMinutes} minutes` : ""}.${forecastMinC == null ? "" : ` The forecast low is ${formatTemp(forecastMinC)}.`}`}
			className="temperature-rule"
			role="img"
		>
			<div aria-hidden="true" className="thermal-gauge">
				<div
					className="thermal-gauge__cool-zone"
					style={{ width: `${toPercent(thresholdC)}%` }}
				/>
				<div
					className="thermal-gauge__tick"
					style={{ left: `${toPercent(thresholdC)}%` }}
				/>
				{forecastMinC == null ? null : (
					<div
						className="thermal-gauge__ghost"
						style={{ left: `${toPercent(forecastMinC)}%` }}
					/>
				)}
				<div
					className="thermal-gauge__marker"
					style={{ left: `${toPercent(outsideC)}%` }}
				/>
			</div>
			<div className="temperature-rule__legend">
				<span>
					<strong>Outside</strong> {formatTemp(outsideC)}
				</span>
				<span>
					<strong>Open below</strong> {formatTemp(thresholdC)}
				</span>
				{forecastMinC == null ? null : (
					<span>
						<strong>Forecast low</strong> {formatTemp(forecastMinC)}
					</span>
				)}
			</div>
			<p className="mt-2 text-sm text-[var(--ww-ink-soft)]">
				The opening threshold is based on {referenceRoomName}
				{horizonMinutes ? ` and the next ${horizonMinutes} minutes` : ""}.
			</p>
		</div>
	);
}

function ChartTooltip({
	active,
	label,
	payload,
}: {
	active?: boolean;
	label?: number | string;
	payload?: Array<{
		color?: string;
		dataKey?: string | number;
		name?: string;
		value?: unknown;
	}>;
}) {
	const rows = (payload || []).filter(
		(item): item is typeof item & { value: number } =>
			typeof item.value === "number",
	);
	if (!active || !rows.length) return null;

	return (
		<div className="surface-panel min-w-40 border-[var(--ww-hairline-strong)] px-3 py-2.5 text-xs">
			<p className="data-label mb-1.5">{formatTime(new Date(Number(label)))}</p>
			<div className="flex flex-col gap-1">
				{rows.map((row) => (
					<div
						className="flex items-center justify-between gap-4"
						key={String(row.dataKey)}
					>
						<span className="flex items-center gap-1.5 font-semibold text-[var(--ww-ink-soft)]">
							<span
								className="size-1.5 rounded-full"
								style={{ backgroundColor: row.color }}
							/>
							{row.name}
						</span>
						<span className="mono-num font-semibold text-[var(--ww-ink)]">
							{row.value.toFixed(1)}°
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function ChartCrosshairCursor({
	activeDataKey,
	height,
	left,
	payload,
	points,
	top,
	width,
	yMax,
	yMin,
}: {
	activeDataKey?: string | null;
	height?: number;
	left?: number;
	payload?: Array<{ dataKey?: string | number; value?: unknown }>;
	points?: Array<{ x?: number; y?: number }>;
	top?: number;
	width?: number;
	yMax: number;
	yMin: number;
}) {
	const x = points?.[0]?.x;
	const chartTop = top ?? 0;
	const chartLeft = left ?? 0;
	const chartHeight = height ?? 0;
	const chartWidth = width ?? 0;
	const entry = payload?.find(
		(item) =>
			activeDataKey &&
			String(item.dataKey) === activeDataKey &&
			typeof item.value === "number",
	);
	const value = typeof entry?.value === "number" ? entry.value : null;

	if (x == null || !chartHeight || !chartWidth || yMax <= yMin) {
		return null;
	}

	const y =
		value == null
			? null
			: chartTop + ((yMax - value) / (yMax - yMin)) * chartHeight;
	const stroke = "var(--ww-ink-faint)";

	return (
		<g className="recharts-tooltip-cursor" pointerEvents="none">
			<line
				stroke={stroke}
				strokeDasharray="4 4"
				strokeOpacity={0.7}
				strokeWidth={1}
				x1={x}
				x2={x}
				y1={chartTop}
				y2={chartTop + chartHeight}
			/>
			{y == null ? null : (
				<line
					stroke={stroke}
					strokeDasharray="4 4"
					strokeOpacity={0.55}
					strokeWidth={1}
					x1={chartLeft}
					x2={chartLeft + chartWidth}
					y1={y}
					y2={y}
				/>
			)}
		</g>
	);
}

type TadoReconnectFlow = Awaited<ReturnType<typeof startTadoReconnect>>;

function TadoReconnectPanel() {
	const queryClient = useQueryClient();
	const [flow, setFlow] = useState<TadoReconnectFlow | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const startMutation = useMutation({
		mutationFn: () => startTadoReconnect(),
		onSuccess: (nextFlow) => {
			setFlow(nextFlow);
			setMessage("Approve the tado login, then this page will reconnect.");
			window.open(nextFlow.verificationUriComplete, "_blank", "noopener");
		},
		onError: (error) => {
			setMessage(
				error instanceof Error ? error.message : "Could not start tado login.",
			);
		},
	});

	const pollMutation = useMutation({
		mutationFn: (flowId: string) => pollTadoReconnect({ data: { flowId } }),
		onSuccess: async (result) => {
			setMessage(result.message);
			if (result.status === "connected") {
				setFlow(null);
				await queryClient.invalidateQueries({
					queryKey: ["window-watcher-dashboard"],
				});
			}
			if (result.status === "expired") setFlow(null);
		},
		onError: (error) => {
			setMessage(
				error instanceof Error ? error.message : "Could not finish tado login.",
			);
		},
	});

	useEffect(() => {
		if (!flow) return;

		const interval = window.setInterval(() => {
			if (!pollMutation.isPending) pollMutation.mutate(flow.flowId);
		}, Math.max(3, flow.intervalSeconds) * 1000);

		return () => window.clearInterval(interval);
	}, [flow, pollMutation.isPending, pollMutation.mutate]);

	return (
		<Alert className="mt-1 border-[var(--ww-hairline)] bg-[var(--ww-gold-soft)]">
			<div className="col-start-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<AlertTitle className="text-sm font-extrabold text-[var(--ww-ink)]">
						tado needs a local reconnect
					</AlertTitle>
					<AlertDescription className="mt-1 text-sm font-semibold text-[var(--ww-ink-soft)]">
						{flow
							? `Code ${flow.userCode} · expires ${formatTime(new Date(flow.expiresAt))}`
							: "This only writes a token on your local dev server."}
					</AlertDescription>
					{message ? (
						<p className="mt-1 text-xs font-semibold text-[var(--ww-ink-faint)]">
							{message}
						</p>
					) : null}
				</div>
				<div className="flex flex-wrap gap-2">
					{flow ? (
						<Button asChild size="sm" variant="outline">
							<a
								href={flow.verificationUriComplete}
								rel="noreferrer"
								target="_blank"
							>
								Open tado
							</a>
						</Button>
					) : null}
					<Button
						disabled={startMutation.isPending}
						onClick={() => startMutation.mutate()}
						size="sm"
						type="button"
					>
						{flow ? "New code" : "Reconnect tado"}
					</Button>
				</div>
			</div>
		</Alert>
	);
}

function shouldShowTadoReconnect(status: DashboardData["status"]) {
	if (!status.stale) return false;
	const reason = status.staleReason?.toLowerCase() || "";
	if (
		reason.includes("429") ||
		reason.includes("rate limit") ||
		reason.includes("rate-limited")
	) {
		return false;
	}
	return (
		reason.includes("tado") ||
		reason.includes("refresh_token") ||
		reason.includes("token")
	);
}

function formatStaleReason(reason: string | undefined) {
	const normalized = reason?.toLowerCase() || "";
	if (
		normalized.includes("429") ||
		normalized.includes("rate limit") ||
		normalized.includes("rate-limited")
	) {
		return "Temporarily rate limited; showing the last saved readings.";
	}
	return `Fresh readings failed: ${reason || "temporarily unavailable"}`;
}

function RoomCard({
	room,
	history,
}: {
	room: RoomReading;
	history: Array<TemperatureHistoryEntry>;
}) {
	const sparklinePoints = getRoomSparkline(history, room.zoneId);
	const hourlyTrend = getRoomHourlyTrend(history, room.zoneId);
	const trendClass = hourlyTrend?.direction || "steady";
	const prediction = room.prediction;

	return (
		<Card className={`room-tile ${trendClass} gap-0 py-0 shadow-none`}>
			<CardContent className="px-4 pt-4 pb-4">
				<h3 className="text-sm font-semibold text-[var(--ww-ink-soft)]">
					{room.zoneName}
				</h3>
				<div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<p className="mono-num text-3xl font-semibold text-[var(--ww-ink)]">
						{formatTemp(room.temperatureC)}
					</p>
					<HourlyTrendBadge trend={hourlyTrend} />
				</div>
				<p className="mt-1 text-sm text-[var(--ww-ink-soft)]">
					{room.verdict.title} · {formatRoomOutsideComparison(room.differenceC)}
					{room.humidityPercent == null
						? ""
						: ` · ${room.humidityPercent.toFixed(0)}% humidity`}
				</p>
				{prediction ? (
					<p className="mt-2 text-xs leading-5 text-[var(--ww-ink-faint)]">
						In {prediction.horizonMinutes} min:{" "}
						{formatTemp(prediction.predictedOpenTemperatureC)} with windows
						open; {formatTemp(prediction.predictedClosedTemperatureC)} closed.
						Expected rebound {formatDelta(prediction.expectedReboundC)}.
					</p>
				) : null}
			</CardContent>
			<Sparkline points={sparklinePoints} />
		</Card>
	);
}

function HourlyTrendBadge({ trend }: { trend: RoomHourlyTrend | null }) {
	if (!trend) {
		return (
			<Badge className="rounded-sm border-none bg-[var(--muted)] font-semibold text-[var(--ww-ink-faint)]">
				No 1h trend
			</Badge>
		);
	}

	const trendClass =
		trend.direction === "rising"
			? "bg-[var(--ww-ember-soft)] text-[var(--ww-ember)]"
			: trend.direction === "falling"
				? "bg-[var(--ww-breeze-soft)] text-[var(--ww-breeze)]"
				: "bg-[var(--muted)] text-[var(--ww-ink-soft)]";

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge className={`rounded-sm border-none font-semibold ${trendClass}`}>
					{trend.direction === "steady"
						? "1h steady"
						: `1h ${formatDelta(trend.changeC)}`}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				{formatDelta(trend.changeC)} over {trend.hours.toFixed(1)}h
			</TooltipContent>
		</Tooltip>
	);
}

function Sparkline({
	points,
}: {
	points: Array<{ time: number; value: number }>;
}) {
	const gradientId = `sparkline-area-${useId().replaceAll(":", "")}`;

	if (points.length < 2) return null;

	const min = Math.min(...points.map((point) => point.value));
	const max = Math.max(...points.map((point) => point.value));
	const padding = Math.max(0.15, (max - min) * 0.2);
	const domain = [min - padding, max + padding];
	const changeC = (points.at(-1)?.value ?? points[0].value) - points[0].value;
	const areaStops = getSparklineAreaStops(points);

	return (
		<div
			aria-label={`Room temperature changed by ${formatDelta(changeC)} over the displayed history.`}
			className="mt-2 h-14 w-full"
			role="img"
		>
			<ResponsiveContainer height="100%" width="100%">
				<ComposedChart
					accessibilityLayer={false}
					data={points}
					margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
				>
					<defs>
						<linearGradient id={gradientId} x1="0%" x2="100%" y1="0%" y2="0%">
							{areaStops.map((stop) => (
								<stop
									key={stop.key}
									offset={`${stop.offset}%`}
									stopColor={stop.color}
									stopOpacity={stop.opacity}
								/>
							))}
						</linearGradient>
					</defs>
					<XAxis
						dataKey="time"
						domain={["dataMin", "dataMax"]}
						hide
						type="number"
					/>
					<YAxis domain={domain} hide />
					<RechartsTooltip
						content={<SparklineTooltip />}
						cursor={{ stroke: "var(--ww-ink-faint)", strokeWidth: 1 }}
						isAnimationActive={false}
					/>
					<Area
						baseValue={domain[0]}
						dataKey="value"
						fill={`url(#${gradientId})`}
						isAnimationActive={false}
						stroke="none"
						type={sparklineCurveType}
					/>
					<Line
						activeDot={{ r: 3, strokeWidth: 1 }}
						dataKey="value"
						dot={false}
						isAnimationActive={false}
						stroke="var(--ww-ink-soft)"
						strokeLinecap="round"
						strokeWidth={3}
						type={sparklineCurveType}
					/>
				</ComposedChart>
			</ResponsiveContainer>
		</div>
	);
}

function SparklineTooltip({
	active,
	payload,
}: {
	active?: boolean;
	payload?: Array<{ payload?: { time: number; value: number } }>;
}) {
	const point = payload?.[0]?.payload;
	if (!active || !point) return null;

	return (
		<div className="surface-panel mono-num border-[var(--ww-hairline-strong)] px-2 py-1 text-xs font-semibold text-[var(--ww-ink)]">
			{formatTemp(point.value)} · {formatTime(new Date(point.time))}
		</div>
	);
}

type RoomHourlyTrend = {
	changeC: number;
	hours: number;
	direction: "rising" | "falling" | "steady";
};

function filterHistory(
	history: Array<TemperatureHistoryEntry>,
	mode: RangeMode,
) {
	const hours =
		mode === "4h"
			? 4
			: mode === "16h"
				? 16
				: mode === "24h"
					? 24
					: mode === "48h"
						? 48
						: 24 * 7;
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	return history.filter(
		(entry) => new Date(entry.checkedAt).getTime() >= cutoff,
	);
}

function findNextAvailableRange(
	history: Array<TemperatureHistoryEntry>,
	currentMode: RangeMode,
) {
	const currentIndex = rangeModes.indexOf(currentMode);
	return rangeModes
		.slice(currentIndex + 1)
		.find((mode) => filterHistory(history, mode).length > 0);
}

function formatRangeLabel(mode: RangeMode) {
	return mode === "week" ? "Past week" : `Past ${mode}`;
}

function buildChartRows(
	history: Array<TemperatureHistoryEntry>,
	rooms: Array<RoomReading>,
	status: DashboardData["status"],
) {
	const rows = history.map((entry) => {
		const row: Record<string, number | string | null> = {
			time: entry.checkedAt,
			timestamp: new Date(entry.checkedAt).getTime(),
			label: formatTime(new Date(entry.checkedAt)),
			outside: entry.outside?.temperatureC ?? null,
			outsideForecast: null,
		};

		for (const room of rooms) {
			const reading = entry.rooms.find(
				(candidate) => String(candidate.zoneId) === String(room.zoneId),
			);
			row[`room-${room.zoneId}`] = reading?.temperatureC ?? null;
		}

		return row;
	});

	const forecastRows = buildTwoHourForecastRows(status, rooms);
	return [...rows, ...forecastRows].sort(
		(left, right) => Number(left.timestamp) - Number(right.timestamp),
	);
}

function buildLegendItems(
	rows: Array<Record<string, number | string | null>>,
	rooms: Array<RoomReading>,
) {
	const hasValue = (key: string) =>
		rows.some((row) => typeof row[key] === "number");

	return [
		hasValue("outside") ? { label: "Outside", color: outsideColor } : null,
		hasValue("outsideForecast")
			? { label: "2h forecast", color: outsideForecastColor }
			: null,
		...rooms.map((room, index) =>
			hasValue(`room-${room.zoneId}`)
				? {
						label: room.zoneName,
						color: roomColors[index % roomColors.length],
					}
				: null,
		),
	].filter((item): item is { label: string; color: string } => item != null);
}

function buildChartAriaLabel(
	rows: Array<Record<string, number | string | null>>,
	legendItems: Array<{ label: string; color: string }>,
	mode: RangeMode,
) {
	const series = legendItems.map((item) => item.label).join(", ");
	return `Temperature chart for the ${formatRangeLabel(mode).toLowerCase()}, showing ${series}. ${rows.length} plotted time points.`;
}

function buildXAxisTicks(
	rows: Array<Record<string, number | string | null>>,
	mode: RangeMode,
) {
	const times = getChartTimeExtent(rows);
	if (!times) return [];

	const [min, max] = times;
	if (mode === "week") {
		return buildLocalTimeTicks(min, max, 24 * 60 * 60 * 1000, 12);
	}

	const stepHours =
		mode === "4h" ? 1 : mode === "16h" ? 4 : mode === "24h" ? 6 : 12;
	return buildLocalTimeTicks(min, max, stepHours * 60 * 60 * 1000);
}

function buildLocalTimeTicks(
	min: number,
	max: number,
	stepMs: number,
	hour = 0,
) {
	const first = new Date(min);
	first.setMinutes(0, 0, 0);
	first.setHours(hour);
	while (first.getTime() < min) {
		first.setTime(first.getTime() + stepMs);
	}

	const ticks = [];
	for (let tick = first.getTime(); tick <= max; tick += stepMs) {
		ticks.push(tick);
	}
	return ticks;
}

function buildMidnightMarkers(
	rows: Array<Record<string, number | string | null>>,
) {
	const times = getChartTimeExtent(rows);
	if (!times) return [];

	const [min, max] = times;
	const first = new Date(min);
	first.setHours(0, 0, 0, 0);
	if (first.getTime() <= min) first.setDate(first.getDate() + 1);

	const markers = [];
	for (let marker = first.getTime(); marker < max; ) {
		markers.push(marker);
		first.setDate(first.getDate() + 1);
		marker = first.getTime();
	}
	return markers;
}

function getChartTimeExtent(
	rows: Array<Record<string, number | string | null>>,
) {
	const timestamps = rows
		.map((row) => row.timestamp)
		.filter(
			(value): value is number =>
				typeof value === "number" && Number.isFinite(value),
		);
	if (!timestamps.length) return null;
	return [Math.min(...timestamps), Math.max(...timestamps)] as const;
}

function buildTwoHourForecastRows(
	status: DashboardData["status"],
	rooms: Array<RoomReading>,
) {
	const checkedTime = new Date(status.checkedAt).getTime();
	const forecastStart = startOfHour(checkedTime - 30 * 60 * 1000);
	const forecastEnd = forecastStart + 2 * 60 * 60 * 1000;
	const forecastPoints = (status.recommendation.forecast?.points || [])
		.map((point) => ({
			time: new Date(point.time).getTime(),
			temperatureC: point.temperatureC,
		}))
		.filter(
			(point) =>
				Number.isFinite(point.time) && Number.isFinite(point.temperatureC),
		)
		.sort((left, right) => left.time - right.time);

	const startPoint =
		getForecastPointAt(forecastPoints, forecastStart) ??
		forecastPoints.find((point) => point.time >= forecastStart);
	const endPoint =
		getForecastPointAt(forecastPoints, forecastEnd) ??
		forecastPoints.findLast((point) => point.time <= forecastEnd);

	if (!startPoint || !endPoint || startPoint.time >= endPoint.time) return [];

	const windowPoints = forecastPoints.filter(
		(point) => point.time > startPoint.time && point.time < endPoint.time,
	);
	const chartPoints = [startPoint, ...windowPoints, endPoint];

	const emptyRooms = Object.fromEntries(
		rooms.map((room) => [`room-${room.zoneId}`, null]),
	);

	return chartPoints.map((point) => ({
		time: new Date(point.time).toISOString(),
		timestamp: point.time,
		label: formatTime(new Date(point.time)),
		outside: null,
		outsideForecast: point.temperatureC,
		...emptyRooms,
	}));
}

function startOfHour(time: number) {
	const date = new Date(time);
	date.setMinutes(0, 0, 0);
	return date.getTime();
}

function getForecastPointAt(
	points: Array<{ time: number; temperatureC: number }>,
	targetTime: number,
) {
	if (!points.length || !Number.isFinite(targetTime)) return null;

	const exact = points.find((point) => point.time === targetTime);
	if (exact) return exact;

	const before = points.findLast((point) => point.time < targetTime);
	const after = points.find((point) => point.time > targetTime);
	if (!before || !after) return null;

	const progress = (targetTime - before.time) / (after.time - before.time);
	return {
		time: targetTime,
		temperatureC:
			before.temperatureC +
			(after.temperatureC - before.temperatureC) * progress,
	};
}

function buildTemperatureScale(
	rows: Array<Record<string, number | string | null>>,
	rooms: Array<RoomReading>,
) {
	const keys = [
		"outside",
		"outsideForecast",
		...rooms.map((room) => `room-${room.zoneId}`),
	];
	const values = rows.flatMap((row) =>
		keys
			.map((key) => row[key])
			.filter((value): value is number => typeof value === "number"),
	);

	if (!values.length)
		return { min: 16, max: 30, ticks: [16, 18, 20, 22, 24, 26, 28, 30] };

	const min = Math.floor((Math.min(...values) - 1) / 2) * 2;
	const max = Math.ceil((Math.max(...values) + 1) / 2) * 2;
	const ticks = [];
	for (let tick = min; tick <= max; tick += 2) ticks.push(tick);
	return { min, max, ticks };
}

function getRoomSparkline(
	history: Array<TemperatureHistoryEntry>,
	zoneId: number | string,
) {
	const cutoff = Date.now() - 2 * 60 * 60 * 1000;
	return getRoomTemperaturePoints(history, zoneId).filter(
		(point) => point.time >= cutoff,
	);
}

function getRoomHourlyTrend(
	history: Array<TemperatureHistoryEntry>,
	zoneId: number | string,
): RoomHourlyTrend | null {
	const points = getRoomTemperaturePoints(history, zoneId);
	if (points.length < 2) return null;

	const latest = points.at(-1);
	if (!latest) return null;

	const oneHourAgo = latest.time - 60 * 60 * 1000;
	const baseline =
		points.findLast((point) => point.time <= oneHourAgo) ??
		points.find((point) => point.time >= oneHourAgo);

	if (!baseline || baseline.time === latest.time) return null;

	const changeC = latest.value - baseline.value;
	const hours = (latest.time - baseline.time) / (60 * 60 * 1000);

	return {
		changeC,
		hours,
		direction:
			Math.abs(changeC) < 0.05 ? "steady" : changeC > 0 ? "rising" : "falling",
	};
}

function getRoomTemperaturePoints(
	history: Array<TemperatureHistoryEntry>,
	zoneId: number | string,
) {
	return history
		.map((entry) => {
			const room = entry.rooms.find(
				(candidate) => String(candidate.zoneId) === String(zoneId),
			);
			return {
				time: new Date(entry.checkedAt).getTime(),
				value: room?.temperatureC,
			};
		})
		.filter(
			(point): point is { time: number; value: number } =>
				Number.isFinite(point.time) && Number.isFinite(point.value),
		)
		.sort((left, right) => left.time - right.time);
}

function formatTemp(value: number | undefined) {
	return value == null ? "—" : `${normalizeDisplayValue(value).toFixed(1)} °C`;
}

function formatDelta(value: number) {
	const normalized = normalizeDisplayValue(value);
	return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)} °C`;
}

function normalizeDisplayValue(value: number) {
	return Math.abs(value) < 0.05 ? 0 : value;
}

function formatRoomOutsideComparison(differenceC: number) {
	const normalized = normalizeDisplayValue(differenceC);
	if (normalized === 0) return "the same temperature as outside";
	return `${Math.abs(normalized).toFixed(1)} °C ${normalized > 0 ? "warmer" : "cooler"} than outside`;
}

function formatMeasurementAge(measuredAt: Date, generatedAt: Date) {
	const ageMs = generatedAt.getTime() - measuredAt.getTime();
	if (!Number.isFinite(ageMs)) return { label: "unknown", minutes: Infinity };

	const minutes = Math.max(0, Math.floor(ageMs / 60_000));
	if (minutes < 1) return { label: "just now", minutes };
	if (minutes < 60) return { label: `${minutes}m ago`, minutes };

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { label: `${hours}h ago`, minutes };

	const days = Math.floor(hours / 24);
	return { label: `${days}d ago`, minutes };
}

function formatMeasurementAgeLong(minutes: number) {
	if (!Number.isFinite(minutes)) return "an unknown age";
	if (minutes < 1) return "current";
	if (minutes < 60)
		return `${minutes} ${minutes === 1 ? "minute" : "minutes"} old`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} old`;

	const days = Math.floor(hours / 24);
	return `${days} ${days === 1 ? "day" : "days"} old`;
}

function formatTime(date: Date) {
	return new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function formatDateTime(date: Date) {
	return new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function formatChartTick(value: number, mode: RangeMode) {
	const date = new Date(value);
	if (mode === "week") {
		return new Intl.DateTimeFormat("en-GB", {
			day: "2-digit",
			month: "2-digit",
			weekday: "short",
		}).format(date);
	}

	if (mode === "48h") {
		return new Intl.DateTimeFormat("en-GB", {
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		}).format(date);
	}

	return formatTime(date);
}
