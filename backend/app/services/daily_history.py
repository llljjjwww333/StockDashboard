from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services.market_calendar import market_hours


def completed_daily_bars(history, market, now=None):
    now = now or datetime.now(timezone.utc)
    if market == 'CRYPTO':
        cutoff = now.astimezone(timezone.utc).date() - timedelta(days=1)
        return sorted([p for p in history.data if date.fromisoformat(p.timestamp[:10]) <= cutoff], key=lambda p: p.timestamp)
    zone = ZoneInfo('Asia/Shanghai' if market == 'CN' else 'America/New_York')
    session = now.astimezone(zone)
    cutoff = session.date()
    hours = market_hours(market, cutoff)
    include_today = False
    try:
        fetched = datetime.fromisoformat((history.fetched_at or '').replace('Z', '+00:00'))
        local_fetch = fetched.astimezone(zone)
        include_today = (fetched.tzinfo is not None and fetched <= now + timedelta(seconds=5)
                         and hours is not None and session.hour * 60 + session.minute >= hours['regular']
                         and local_fetch.date() == cutoff and local_fetch.hour * 60 + local_fetch.minute >= hours['regular'])
    except (ValueError, TypeError):
        pass
    if not include_today:
        cutoff -= timedelta(days=1)
        while not market_hours(market, cutoff):
            cutoff -= timedelta(days=1)
    points = []
    for point in history.data:
        try:
            day = date.fromisoformat(point.timestamp[:10])
        except ValueError:
            continue
        if day <= cutoff and market_hours(market, day):
            points.append(point)
    return sorted(points, key=lambda point: point.timestamp[:10])
