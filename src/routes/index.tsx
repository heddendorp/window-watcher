import { SignInButton, UserButton, useUser } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Button } from "../components/ui/button";
import { createHistoryCollection } from "../window-watcher/db";
import { getDashboardData } from "../window-watcher/functions";
import type {
	DashboardData,
	RoomReading,
	TemperatureHistoryEntry,
} from "../window-watcher/types";

export const Route = createFileRoute("/")({ component: App });

type RangeMode = "4h" | "16h" | "24h" | "48h" | "week";

const roomColors = ["#0f8b5f", "#b03a2e", "#a56b00", "#6750a4", "#b35c14"];
const outsideColor = "#1f789d";
const outsideForecastColor = "#8bbbd0";
const mainChartCurveType = "basis";
const sparklineCurveType = mainChartCurveType;
const sparklineRiseColor = "#d23f36";
const sparklineFallColor = "#0b8a61";
const sparklineFlatColor = "#6f7c75";
const authEnabled = import.meta.env.VITE_WINDOW_WATCHER_AUTH === "true";

function App() {
	if (authEnabled) return <AuthenticatedApp />;
	return <DashboardQuery authEnabled={false} />;
}

function AuthenticatedApp() {
	const { isLoaded, isSignedIn } = useUser();

	if (!isLoaded) {
		return (
			<main className="mx-auto flex min-h-screen max-w-7xl items-center px-5">
				<p className="text-lg font-semibold text-slate-700">
					Loading sign-in state...
				</p>
			</main>
		);
	}

	if (!isSignedIn) return <AuthGate />;
	return <DashboardQuery authEnabled={true} />;
}

function DashboardQuery({ authEnabled }: { authEnabled: boolean }) {
	const [rangeMode, setRangeMode] = useState<RangeMode>("4h");
	const dashboard = useQuery({
		queryKey: ["window-watcher-dashboard"],
		queryFn: () => getDashboardData(),
		refetchInterval: 60_000,
	});

	if (dashboard.isLoading) {
		return (
			<main className="mx-auto flex min-h-screen max-w-7xl items-center px-5">
				<p className="text-lg font-semibold text-slate-700">
					Loading temperature readings...
				</p>
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
			<main className="mx-auto flex min-h-screen max-w-7xl items-center px-5">
				<section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
					<h1 className="text-2xl font-bold text-slate-950">Window Watcher</h1>
					<p className="mt-3 text-red-700">
						{dashboard.error instanceof Error
							? dashboard.error.message
							: "Could not load temperatures."}
					</p>
				</section>
			</main>
		);
	}

	return (
		<Dashboard
			authEnabled={authEnabled}
			data={dashboard.data}
			rangeMode={rangeMode}
			setRangeMode={setRangeMode}
		/>
	);
}

function AuthGate() {
	return (
		<main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 text-slate-900">
			<section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
				<h1 className="text-2xl font-extrabold text-slate-950">
					Window Watcher
				</h1>
				<p className="mt-3 text-sm font-medium leading-6 text-slate-600">
					Sign in with the authorized Google account to view the flat
					temperatures and recommendations.
				</p>
				<div className="mt-5">
					<SignInButton mode="modal">
						<Button type="button">Sign in with Google</Button>
					</SignInButton>
				</div>
			</section>
		</main>
	);
}

function Dashboard({
	authEnabled,
	data,
	rangeMode,
	setRangeMode,
}: {
	authEnabled: boolean;
	data: DashboardData;
	rangeMode: RangeMode;
	setRangeMode: (mode: RangeMode) => void;
}) {
	const { status, history } = data;
	const latestAt = new Date(status.checkedAt);
	const historyCollection = useMemo(
		() => createHistoryCollection(history),
		[history],
	);
	const filteredHistory = useMemo(
		() => filterHistory(history, rangeMode),
		[history, rangeMode],
	);
	const chartRows = useMemo(
		() => buildChartRows(filteredHistory, status.rooms, status),
		[filteredHistory, status],
	);
	const chartScale = useMemo(
		() => buildTemperatureScale(chartRows, status.rooms),
		[chartRows, status.rooms],
	);
	const legendItems = [
		{ label: "Outside", color: outsideColor },
		{ label: "30 min forecast", color: outsideForecastColor },
		...status.rooms.map((room, index) => ({
			label: room.zoneName,
			color: roomColors[index % roomColors.length],
		})),
	];

	return (
		<main className="mx-auto min-h-screen max-w-7xl px-3 py-3 text-slate-900 sm:px-5 sm:py-5">
			<section className={`main-card ${status.verdict.action}`}>
				<div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-3">
							<h1 className="text-2xl font-extrabold tracking-normal text-slate-950 sm:text-3xl">
								Window Watcher
							</h1>
							{authEnabled ? <UserButton /> : null}
						</div>
						<p className="mt-1 max-w-4xl text-sm font-medium leading-6 text-slate-600">
							{status.location.label} · updated {formatTime(latestAt)}
							{status.stale
								? ` · stale since ${formatTime(new Date(status.lastFreshAt || status.checkedAt))}`
								: ""}
						</p>
					</div>
					<div className="text-left sm:text-right">
						<p className="text-sm font-semibold uppercase text-slate-500">
							Outside
						</p>
						<p className="text-3xl font-extrabold text-slate-950 sm:text-4xl">
							{formatTemp(status.outside.temperatureC)}
						</p>
					</div>
				</div>

				<div className="mt-5 grid gap-4 lg:grid-cols-[1fr_18rem]">
					<div>
						<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
							<h2 className="text-xl font-extrabold text-slate-950 sm:text-2xl">
								{status.verdict.title}
							</h2>
							<p className="text-base font-medium text-slate-700">
								{status.verdict.detail}
							</p>
						</div>
						{status.stale ? (
							<p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
								Fresh readings failed: {status.staleReason}
							</p>
						) : null}
						{status.recommendation.forecast?.summary ? (
							<p className="mt-2 text-sm font-semibold text-slate-700">
								{status.recommendation.forecast.summary}
							</p>
						) : null}
					</div>
					<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
						<p className="text-xs font-bold uppercase text-slate-500">
							Outdoor trend
						</p>
						<p className="mt-1 text-sm font-semibold text-slate-800">
							{status.recommendation.outdoorTrend.direction} ·{" "}
							{formatDelta(status.recommendation.outdoorTrend.changeC)} over{" "}
							{status.recommendation.outdoorTrend.hours.toFixed(1)}h
						</p>
						<p className="mt-1 text-xs text-slate-600">
							Threshold {formatTemp(status.recommendation.thresholdC)}
							{status.recommendation.forecast?.minTemperatureC == null
								? ""
								: ` · next ${status.recommendation.forecast.horizonHours.toFixed(0)}h low ${formatTemp(status.recommendation.forecast.minTemperatureC)}`}
						</p>
					</div>
				</div>
			</section>

			<section className="mt-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:mt-5 sm:p-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 className="text-xl font-extrabold text-slate-950 sm:text-2xl">
							Temperature Trends
						</h2>
						<p className="mt-1 text-sm font-medium text-slate-600">
							{rangeMode} · {filteredHistory.length} saved measurements
						</p>
					</div>
					<div className="range-scroll flex w-full gap-1 overflow-x-auto rounded-md border border-slate-200 bg-white p-1 sm:w-auto">
						{(["4h", "16h", "24h", "48h", "week"] as const).map((mode) => (
							<Button
								key={mode}
								onClick={() => setRangeMode(mode)}
								size="sm"
								type="button"
								variant={rangeMode === mode ? "default" : "ghost"}
							>
								{mode === "week" ? "Week" : mode}
							</Button>
						))}
					</div>
				</div>
				<div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
					{legendItems.map((item) => (
						<div
							className="flex items-center gap-2 text-xs font-extrabold uppercase text-slate-600"
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
				<div className="h-[18rem] w-full sm:h-[22rem]">
					<ResponsiveContainer height="100%" width="100%">
						<LineChart
							data={chartRows}
							margin={{ top: 8, right: 18, bottom: 0, left: 0 }}
						>
							<CartesianGrid stroke="#d9e5de" vertical={false} />
							<XAxis
								dataKey="label"
								minTickGap={28}
								stroke="#64746d"
								tickLine={false}
							/>
							<YAxis
								domain={[chartScale.min, chartScale.max]}
								stroke="#64746d"
								tickFormatter={(value) => `${value} C`}
								tickLine={false}
								ticks={chartScale.ticks}
								width={54}
							/>
							<Tooltip
								contentStyle={{
									borderRadius: 8,
									border: "1px solid #d7e2dc",
									boxShadow: "0 12px 30px rgba(15, 23, 42, 0.12)",
								}}
								formatter={(value) => `${Number(value).toFixed(1)} C`}
							/>
							<Line
								connectNulls={false}
								dataKey="outside"
								dot={false}
								name="Outside"
								stroke={outsideColor}
								strokeWidth={3}
								type={mainChartCurveType}
							/>
							<Line
								connectNulls={false}
								dataKey="outsideForecast"
								dot={false}
								name="30 min forecast"
								stroke={outsideForecastColor}
								strokeDasharray="5 5"
								strokeWidth={2.5}
								type="monotone"
							/>
							{status.rooms.map((room, index) => (
								<Line
									connectNulls={false}
									dataKey={`room-${room.zoneId}`}
									dot={false}
									key={room.zoneId}
									name={room.zoneName}
									stroke={roomColors[index % roomColors.length]}
									strokeWidth={2.5}
									type={mainChartCurveType}
								/>
							))}
						</LineChart>
					</ResponsiveContainer>
				</div>
			</section>

			<section className="mt-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:mt-5 sm:p-5">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-extrabold text-slate-950 sm:text-2xl">
						Rooms
					</h2>
					<p className="text-sm font-medium text-slate-600">
						{status.rooms.length} tado rooms
					</p>
				</div>
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{status.rooms.map((room) => (
						<RoomCard history={history} key={room.zoneId} room={room} />
					))}
				</div>
			</section>
			<footer className="px-1 py-4 text-xs font-medium text-slate-500">
				Auto-refreshes every minute · TanStack DB {historyCollection.id}
			</footer>
		</main>
	);
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

	return (
		<article className={`room-card ${room.verdict.action}`}>
			<div className="px-4 pt-4">
				<p className="text-xs font-extrabold uppercase text-slate-500">
					{room.zoneName}
				</p>
				<div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<p className="text-3xl font-extrabold text-slate-950 sm:text-4xl">
						{formatTemp(room.temperatureC)}
					</p>
					<p className="text-sm font-semibold text-slate-600">
						{room.verdict.title} · {formatDelta(room.differenceC)} vs outside
						{room.humidityPercent == null
							? ""
							: ` · ${room.humidityPercent.toFixed(0)}% humidity`}
					</p>
					<HourlyTrendBadge trend={hourlyTrend} />
				</div>
			</div>
			<Sparkline points={sparklinePoints} />
		</article>
	);
}

function HourlyTrendBadge({ trend }: { trend: RoomHourlyTrend | null }) {
	if (!trend) {
		return (
			<span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-extrabold text-slate-500">
				1h -
			</span>
		);
	}

	const trendClass =
		trend.direction === "rising"
			? "bg-red-50 text-red-700"
			: trend.direction === "falling"
				? "bg-emerald-50 text-emerald-700"
				: "bg-slate-100 text-slate-600";

	return (
		<span
			className={`rounded-full px-2 py-1 text-xs font-extrabold ${trendClass}`}
			title={`${formatDelta(trend.changeC)} over ${trend.hours.toFixed(1)}h`}
		>
			1h {formatDelta(trend.changeC)}
		</span>
	);
}

function Sparkline({
	points,
}: {
	points: Array<{ time: number; value: number }>;
}) {
	const gradientId = `sparkline-${useId().replaceAll(/[^a-zA-Z0-9_-]/g, "")}`;

	if (points.length < 2) return <div className="h-16" />;

	const min = Math.min(...points.map((point) => point.value));
	const max = Math.max(...points.map((point) => point.value));
	const padding = Math.max(0.15, (max - min) * 0.2);
	const domain = [min - padding, max + padding];
	const gradientStops = buildSparklineGradientStops(points);

	return (
		<div className="mt-2 h-16 w-full">
			<ResponsiveContainer height="100%" width="100%">
				<LineChart
					data={points}
					margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
				>
					<XAxis
						dataKey="time"
						domain={["dataMin", "dataMax"]}
						hide
						type="number"
					/>
					<YAxis domain={domain} hide />
					<defs>
						<linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
							{gradientStops.map((stop) => (
								<stop
									key={stop.id}
									offset={`${stop.offset}%`}
									stopColor={stop.color}
								/>
							))}
						</linearGradient>
					</defs>
					<Tooltip
						content={<SparklineTooltip />}
						cursor={{ stroke: "#9aaba3", strokeWidth: 1 }}
						isAnimationActive={false}
					/>
					<Line
						activeDot={{
							fill: "#ffffff",
							r: 3,
							stroke: "#17221f",
							strokeWidth: 2,
						}}
						dataKey="value"
						dot={false}
						isAnimationActive={false}
						stroke="transparent"
						strokeWidth={8}
						type={sparklineCurveType}
					/>
					<Line
						activeDot={false}
						dataKey="value"
						dot={false}
						isAnimationActive={false}
						stroke={`url(#${gradientId})`}
						strokeLinecap="round"
						strokeWidth={3}
						type={sparklineCurveType}
					/>
				</LineChart>
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
		<div className="rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-xs font-bold text-slate-700 shadow-sm">
			{formatTemp(point.value)} · {formatTime(new Date(point.time))}
		</div>
	);
}

function buildSparklineGradientStops(
	points: Array<{ time: number; value: number }>,
) {
	const firstTime = points[0].time;
	const lastTime = points.at(-1)?.time ?? firstTime;
	const duration = Math.max(1, lastTime - firstTime);
	const stops: Array<{
		id: string;
		color: string;
		offset: number;
	}> = [];

	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const point = points[index];
		const color = getSparklineTrendColor(point.value - previous.value);
		const startOffset = ((previous.time - firstTime) / duration) * 100;
		const endOffset = ((point.time - firstTime) / duration) * 100;

		stops.push(
			{ id: `${index}-start`, color, offset: startOffset },
			{ id: `${index}-end`, color, offset: endOffset },
		);
	}

	return stops;
}

function getSparklineTrendColor(delta: number) {
	if (Math.abs(delta) < 0.03) return sparklineFlatColor;
	return delta > 0 ? sparklineRiseColor : sparklineFallColor;
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

function buildChartRows(
	history: Array<TemperatureHistoryEntry>,
	rooms: Array<RoomReading>,
	status: DashboardData["status"],
) {
	const rows = history.map((entry) => {
		const row: Record<string, number | string | null> = {
			time: entry.checkedAt,
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

	const forecastRows = buildThirtyMinuteForecastRows(status, rooms);
	return [...rows, ...forecastRows];
}

function buildThirtyMinuteForecastRows(
	status: DashboardData["status"],
	rooms: Array<RoomReading>,
) {
	const nextPoint = status.recommendation.forecast?.points?.find(
		(point) =>
			new Date(point.time).getTime() > new Date(status.checkedAt).getTime(),
	);
	if (!nextPoint) return [];

	const checkedTime = new Date(status.checkedAt).getTime();
	const nextTime = new Date(nextPoint.time).getTime();
	const forecastTime = checkedTime + 30 * 60 * 1000;
	if (!Number.isFinite(nextTime) || nextTime <= checkedTime) return [];

	const progress = Math.min(
		1,
		(forecastTime - checkedTime) / (nextTime - checkedTime),
	);
	const forecastTemperature =
		status.outside.temperatureC +
		(nextPoint.temperatureC - status.outside.temperatureC) * progress;

	const emptyRooms = Object.fromEntries(
		rooms.map((room) => [`room-${room.zoneId}`, null]),
	);

	return [
		{
			time: status.checkedAt,
			label: formatTime(new Date(status.checkedAt)),
			outside: null,
			outsideForecast: status.outside.temperatureC,
			...emptyRooms,
		},
		{
			time: new Date(forecastTime).toISOString(),
			label: formatTime(new Date(forecastTime)),
			outside: null,
			outsideForecast: forecastTemperature,
			...emptyRooms,
		},
	];
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
	return value == null ? "-" : `${value.toFixed(1)} C`;
}

function formatDelta(value: number) {
	return `${value >= 0 ? "+" : ""}${value.toFixed(1)} C`;
}

function formatTime(date: Date) {
	return new Intl.DateTimeFormat("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}
