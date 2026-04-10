"use client";

import { useEffect, useRef } from "react";

interface PricePoint {
  t: number;
  p: number;
}

interface Props {
  data: PricePoint[];
  buyPrice?: number;
}

export default function PriceChart({ data, buyPrice }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!chartRef.current || data.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ApexCharts: any;

    import("apexcharts").then((mod) => {
      ApexCharts = mod.default;

      const series = data.map((p) => ({ x: p.t, y: p.p }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const annotations: any = {};
      if (buyPrice) {
        annotations.yaxis = [{
          y: buyPrice,
          borderColor: "#EAB308",
          strokeDashArray: 4,
          borderWidth: 1.5,
          label: {
            text: `Buy @ ${buyPrice.toLocaleString()}`,
            style: { color: "#000", background: "#EAB308", fontSize: "11px", fontWeight: "600" },
          },
        }];
      }

      const options = {
        chart: {
          type: "area" as const,
          height: 240,
          background: "transparent",
          toolbar: { show: false },
          zoom: { enabled: false },
          animations: { enabled: true, speed: 500 },
        },
        theme: { mode: "dark" as const },
        series: [{ name: "EGP/gram", data: series }],
        xaxis: {
          type: "datetime" as const,
          labels: {
            style: { colors: "#78716C", fontSize: "11px" },
            datetimeFormatter: { hour: "HH:mm" },
          },
          axisBorder: { show: false },
          axisTicks: { show: false },
        },
        yaxis: {
          labels: {
            style: { colors: "#78716C", fontSize: "11px" },
            formatter: (v: number) => v.toLocaleString("en-EG", { maximumFractionDigits: 0 }),
          },
        },
        stroke: { curve: "smooth" as const, width: 2, colors: ["#EAB308"] },
        fill: {
          type: "gradient",
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.25,
            opacityTo: 0.01,
            stops: [0, 100],
            colorStops: [
              { offset: 0, color: "#CA8A04", opacity: 0.3 },
              { offset: 100, color: "#CA8A04", opacity: 0 },
            ],
          },
        },
        grid: {
          borderColor: "rgba(255,255,255,0.04)",
          xaxis: { lines: { show: false } },
        },
        tooltip: {
          theme: "dark",
          x: { format: "HH:mm dd MMM" },
          y: { formatter: (v: number) => `${v.toLocaleString()} EGP/g` },
        },
        dataLabels: { enabled: false },
        markers: { size: 0 },
        annotations,
      };

      if (instanceRef.current) {
        (instanceRef.current as InstanceType<typeof ApexCharts>).updateOptions(options, true, false);
      } else {
        const chart = new ApexCharts(chartRef.current!, options);
        chart.render();
        instanceRef.current = chart;
      }
    });

    return () => {
      if (instanceRef.current) {
        (instanceRef.current as { destroy: () => void }).destroy();
        instanceRef.current = null;
      }
    };
  }, [data, buyPrice]);

  if (data.length === 0) {
    return (
      <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        No price data yet — bot will populate chart after first tick
      </div>
    );
  }

  return <div ref={chartRef} />;
}
