import React, { useEffect, useState } from 'react';
import Chart from 'react-apexcharts';
import { useStockStore } from '../store/stockStore';

interface KLineChartProps {
  ticker: string;
}

const KLineChart: React.FC<KLineChartProps> = ({ ticker }) => {
  const { stockData, setStockData } = useStockStore();
  const [timeframe, setTimeframe] = useState<string>('1d');
  const [chartData, setChartData] = useState<any>({
    series: [],
    options: {},
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/v1/stocks/${ticker}/history`);
        const data = await response.json();
        
        const processedData = data.data.map((item: any) => {
          return [
            new Date(item.timestamp).getTime(),
            item.open,
            item.high,
            item.low,
            item.close,
          ];
        });
        
        setStockData(ticker, processedData);
        updateChart(processedData);
      } catch (error) {
        console.error('Error fetching historical data:', error);
        const mockData = generateMockData();
        setStockData(ticker, mockData);
        updateChart(mockData);
      }
    };

    fetchData();
  }, [ticker, timeframe, setStockData]);

  const generateMockData = () => {
    const data = [];
    const now = new Date().getTime();
    let interval: number;
    let count: number;
    
    switch (timeframe) {
      case '1d':
        interval = 15 * 60 * 1000; // 15分钟
        count = 96; // 24小时
        break;
      case '1w':
        interval = 1 * 60 * 60 * 1000; // 1小时
        count = 168; // 7天
        break;
      case '1m':
        interval = 4 * 60 * 60 * 1000; // 4小时
        count = 180; // 30天
        break;
      case '3m':
        interval = 1 * 24 * 60 * 60 * 1000; // 1天
        count = 90; // 90天
        break;
      case '1y':
        interval = 7 * 24 * 60 * 60 * 1000; // 7天
        count = 52; // 52周
        break;
      default:
        interval = 1 * 24 * 60 * 60 * 1000;
        count = 180;
    }
    
    let basePrice = 100 + Math.random() * 100;
    
    for (let i = count; i >= 0; i--) {
      const timestamp = now - (i * interval);
      const change = (Math.random() - 0.48) * 5;
      const open = basePrice;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * 3;
      const low = Math.min(open, close) - Math.random() * 3;
      
      basePrice = close;
      
      data.push([timestamp, open, high, low, close]);
    }
    
    return data;
  };

  const updateChart = (data: any[]) => {
    setChartData({
      series: [{
        data: data,
        name: ticker,
      }],
      options: {
        chart: {
          type: 'candlestick',
          height: 500,
          background: 'transparent',
          toolbar: {
            show: true,
            tools: {
              download: true,
              zoom: true,
              zoomin: true,
              zoomout: true,
              pan: true,
              reset: true,
            },
          },
        },
        title: {
          text: `${ticker} K-Line Chart`,
          align: 'left',
          style: {
            color: '#ffffff',
            fontSize: '18px',
            fontWeight: '600',
          },
        },
        xaxis: {
          type: 'datetime',
          labels: {
            style: {
              colors: '#9ca3af',
            },
            formatter: function (value: number) {
              const date = new Date(value);
              if (timeframe === '1d') {
                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
              } else if (timeframe === '1w' || timeframe === '1m') {
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              } else if (timeframe === '3m') {
                return date.toLocaleDateString('en-US', { month: 'short' });
              } else {
                return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
              }
            },
          },
          axisBorder: {
            color: '#2d2d44',
          },
          axisTicks: {
            color: '#2d2d44',
          },
        },
        yaxis: {
          labels: {
            style: {
              colors: '#9ca3af',
            },
            formatter: function (value: number) {
              return '$' + value.toFixed(2);
            },
          },
          opposite: true,
        },
        tooltip: {
          enabled: true,
          theme: 'custom',
          custom: function({ series, seriesIndex, dataPointIndex, w }) {
            const data = w.config.series[seriesIndex].data[dataPointIndex];
            return `<div style="background-color: #1a1a2e; border: 1px solid #2d2d44; border-radius: 8px; padding: 12px; color: #ffffff; font-family: Inter, system-ui, sans-serif;">
              <div style="font-weight: 600; margin-bottom: 8px;">${new Date(data[0]).toLocaleString()}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Open:</span>
                <span style="font-weight: 500;">$${data[1].toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>High:</span>
                <span style="font-weight: 500;">$${data[2].toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Low:</span>
                <span style="font-weight: 500;">$${data[3].toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Close:</span>
                <span style="font-weight: 500;">$${data[4].toFixed(2)}</span>
              </div>
            </div>`;
          },
          marker: {
            show: true,
          },
          shared: true,
          intersect: false,
        },
        plotOptions: {
          candlestick: {
            colors: {
              upward: '#22c55e',
              downward: '#ef4444',
            },
            wick: {
              useFillColor: true,
            },
          },
        },
        grid: {
          borderColor: '#2d2d44',
          strokeDashArray: 5,
          xaxis: {
            lines: {
              show: false,
            },
          },
          yaxis: {
            lines: {
              show: true,
            },
          },
        },
      },
    });
  };

  const timeframes = [
    { key: '1d', label: '1D' },
    { key: '1w', label: '1W' },
    { key: '1m', label: '1M' },
    { key: '3m', label: '3M' },
    { key: '1y', label: '1Y' },
  ];

  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Price Chart</h2>
        <div className="flex space-x-2">
          {timeframes.map((tf) => (
            <button
              key={tf.key}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${timeframe === tf.key ? 'bg-accent text-white shadow-glow' : 'bg-tertiary text-gray-300 hover:bg-cardHover'}`}
              onClick={() => setTimeframe(tf.key)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <Chart
        options={chartData.options}
        series={chartData.series}
        type="candlestick"
        height={500}
      />
    </div>
  );
};

export default KLineChart;
