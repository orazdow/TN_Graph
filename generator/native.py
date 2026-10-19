"""Translate the generator's internal facts to the dashboard's JSON structure.

Phrase and numeric shapes follow bike.json. Strings retain their text as values.
Unknown units and unsupported value types fail explicitly.
"""
from decimal import Decimal
from html import escape
import re
from uuid import NAMESPACE_URL, uuid5


# symbol: (SI symbol, scale, quantity). Compound units combine these scales.
UNITS = {
    'm': ('m', '1', 'length'), 'mm': ('m', '.001', 'length'),
    'cm': ('m', '.01', 'length'), 'km': ('m', '1000', 'length'),
    'inches': ('m', '.0254', 'length'), 'inch': ('m', '.0254', 'length'),
    'in': ('m', '.0254', 'length'), 'ft': ('m', '.3048', 'length'),
    'kg': ('kg', '1', 'mass'), 'g': ('kg', '.001', 'mass'),
    'tonnes': ('kg', '1000', 'mass'), 's': ('s', '1', 'time'),
    'sec': ('s', '1', 'time'), 'min': ('s', '60', 'time'),
    'h': ('s', '3600', 'time'), 'K': ('K', '1', 'temperature'),
    'N': ('N', '1', 'force'), 'kN': ('N', '1000', 'force'),
    'Pa': ('Pa', '1', 'pressure'), 'kPa': ('Pa', '1000', 'pressure'),
    'MPa': ('Pa', '1000000', 'pressure'), 'GPa': ('Pa', '1000000000', 'pressure'),
    'bar': ('Pa', '100000', 'pressure'), 'W': ('W', '1', 'power'),
    'kW': ('W', '1000', 'power'), 'V': ('V', '1', 'voltage'),
    'A': ('A', '1', 'current'), '%': ('unity', '.01', 'dimensionless'),
    'unity': ('unity', '1', 'dimensionless'),
}


def phrase_path(phrase):
    """Reverse phrase terms and 'of' segments; retain already encoded paths."""
    phrase = phrase.strip()
    if not phrase:
        raise ValueError('empty native phrase')
    if re.fullmatch(r'[\w:-]+(?:/[\w:-]+)*', phrase):
        return phrase
    segments = re.split(r'\s+of\s+', phrase)
    paths = []
    for segment in segments:
        words = []
        # Commas place the following phrase first; colons reverse local terms.
        for part in reversed(segment.split(',')):
            for word in part.split():
                words.extend(reversed(word.split(':')))
        if not words or any(not re.fullmatch(r'[\w-]+', word) for word in words):
            raise ValueError(f'unsupported phrase syntax: {phrase}')
        paths.append(':'.join(reversed(words)))
    return '/'.join(reversed(paths))


def number_text(value):
    """Use decimal text for magnitudes, including exact unit conversions."""
    number = Decimal(str(value))
    if not number.is_finite():
        raise ValueError('native numeric magnitudes must be finite')
    text = format(number, 'f')
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return '0' if number == 0 else text


def unit_data(unit):
    """Return stated powers, SI powers, scale, offset, and inferred quantity."""
    if not unit or unit == 'unity':
        powers = [{'p': 1, 'u': 'unity'}]
        return powers, powers.copy(), Decimal(1), Decimal(0), 'dimensionless'
    if unit == 'degC':
        return ([{'p': 1, 'u': 'degC'}], [{'p': 1, 'u': 'K'}],
                Decimal(1), Decimal('273.15'), 'temperature')
    stated, si = {}, {}
    scale, sign = Decimal(1), 1
    tokens = re.split(r'([*/])', re.sub(r'\s+', '*', unit.strip()))
    quantity = None
    for token in tokens:
        if token in ('*', '/'):
            sign = -1 if token == '/' else 1
            continue
        match = re.fullmatch(r'([A-Za-z%]+)(?:\^([+-]?\d+))?', token)
        if not match or match[1] not in UNITS:
            raise ValueError(f'unsupported native unit: {unit}; add its SI conversion to native.py')
        symbol = match[1]
        power = int(match[2] or 1) * sign
        si_symbol, factor, inferred = UNITS[symbol]
        stated[symbol] = stated.get(symbol, 0) + power
        si[si_symbol] = si.get(si_symbol, 0) + power
        scale *= Decimal(factor) ** power
        if len(tokens) == 1:
            quantity = inferred if power == 1 else {'length': {2: 'area', 3: 'volume'}}.get(inferred, {}).get(power)
    if not quantity:
        quantity = {('N', 'm'): 'moment', ('kN', 'm'): 'moment'}.get(tuple(stated))
    def powers(values):
        return [{'p': power, 'u': symbol} for symbol, power in values.items() if power] or [{'p': 1, 'u': 'unity'}]
    return powers(stated), powers(si), scale, Decimal(0), quantity


def unit_text(powers):
    return '*'.join(item['u'] + (f"^{item['p']}" if item['p'] != 1 else '') for item in powers)


def native_value(value):
    if value['type'] == 'reference':
        path = phrase_path(value['subject'])
        return dict(type='srd', value=path, html=escape(path))
    if value['type'] == 'string':
        text = value['text']
        return dict(type='string', value=text, html=escape(text))
    if value['type'] != 'numeric':
        raise ValueError(f"unsupported native value type: {value['type']}")
    stated, si, scale, offset, quantity = unit_data(value['unit'])
    magnitude = number_text(value['magnitude'])
    tolerance = number_text(value.get('tolerance', 0))
    if Decimal(tolerance) < 0:
        raise ValueError('numeric tolerance must be nonnegative')
    si_magnitude = number_text(Decimal(magnitude) * scale + offset)
    si_tolerance = number_text(Decimal(tolerance) * abs(scale))
    display = magnitude + (' ' + value['unit'] if value['unit'] else '')
    result = dict(type='numeric', value=display, magnitude=magnitude, tolerance=tolerance,
                  html=escape(display), unitPowers=stated,
                  quantity=value.get('quantity') or quantity,
                  siValue=dict(value=si_magnitude + ' ' + unit_text(si), magnitude=si_magnitude,
                               tolerance=si_tolerance, unitPowers=si))
    if not result['quantity']:
        raise ValueError(f"numeric property needs quantity metadata for unit {value['unit']}")
    return result


def to_native(data, numberspace='generated'):
    """Export an array of native records; don't fabricate creator identities."""
    if not numberspace.strip():
        raise ValueError('numberspace must be nonempty')
    records = []
    for fact in data['facts']:
        # Stable UUIDs reproduce the same generated records on repeated exports.
        key = f"tn-graph:{data.get('name', '')}:{data.get('seed', '')}:{fact['id']}"
        tags = [phrase_path(tag) for tag in fact['tags']]
        records.append(dict(
            _id=str(uuid5(NAMESPACE_URL, key)), subject=phrase_path(fact['subject']),
            property=phrase_path(fact['property']), trueStatement=fact['statement'],
            numberspace=numberspace, tags=tags,
            tagMeta={tag: {'immutable': True} for tag in tags}, value=native_value(fact['value'])))
    return records
