type SparklinePoint = {
	time: number;
	value: number;
};

export function getSparklineAreaStops(points: Array<SparklinePoint>) {
	const firstTime = points[0]?.time ?? 0;
	const lastTime = points.at(-1)?.time ?? firstTime;
	const duration = Math.max(1, lastTime - firstTime);

	return points.slice(0, -1).flatMap((point, index) => {
		const nextPoint = points[index + 1];
		const direction = Math.sign(nextPoint.value - point.value);
		const color =
			direction > 0
				? "var(--ww-ember)"
				: direction < 0
					? "var(--ww-breeze)"
					: "var(--ww-ink-faint)";
		const opacity = direction === 0 ? 0.08 : 0.18;
		const startOffset = ((point.time - firstTime) / duration) * 100;
		const endOffset = ((nextPoint.time - firstTime) / duration) * 100;

		return [
			{
				key: `${index}-start`,
				offset: startOffset,
				color,
				opacity,
			},
			{
				key: `${index}-end`,
				offset: endOffset,
				color,
				opacity,
			},
		];
	});
}
