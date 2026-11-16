# Laptop price API
#
# Install:   pip install fastapi uvicorn pandas scikit-learn catboost joblib
# Run:       python -m uvicorn main:app --reload
# Docs:      http://127.0.0.1:8000/docs
#
# laptop_model.joblib (saved from the notebook) must be in the same folder as this file.
# Use the same scikit-learn version that the notebook printed, otherwise loading may fail.

import difflib
import re
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


bundle = joblib.load(Path(__file__).parent / 'laptop_model.joblib')
model = bundle['model']        # the full pipeline (preprocessing + model)
lookup = bundle['lookup']      # the cleaned laptops with their short Name
options = bundle['options']    # dropdown choices: {field: [{'value': ..., 'label': ...}]}

app = FastAPI(title='Laptop Price API')

# allow the frontend to call the API from the browser
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

# API field name -> column name used in training
FIELD_TO_COLUMN = {
    'brand': 'Brand',
    'cpu': 'CPU',
    'gpu': 'GPU',
    'storage_type': 'Storage type',
    'ram': 'RAM',
    'storage': 'Storage',
    'screen': 'Screen',
    'status': 'Status',
    'touch': 'Touch',
}

# if no laptop has the exact specs, these are dropped one by one (brand is never dropped)
RELAX_ORDER = ['Screen', 'Touch', 'Status', 'Storage type', 'Storage', 'RAM', 'GPU', 'CPU']

# same words that were removed from the CPU column in the notebook
CPU_WORDS = ['intel', 'core', 'amd', 'mediatek', 'qualcomm', 'microsoft', 'apple', 'evo']


class LaptopSpecs(BaseModel):
    brand: str
    cpu: str
    gpu: str
    storage_type: str
    ram: int | float | str          # 16, '16gb'
    storage: int | float | str      # 1024, '1T', '512gb', 990
    screen: int | float | str       # 15.6, 17, '17 inch'
    status: int | str | bool        # 1, 'new', 'refurbished'
    touch: int | str | bool         # 0, 'no', 'touch', 'not touch'

    model_config = {'json_schema_extra': {'example': {
        'brand': 'HP', 'cpu': 'Intel Core i7', 'gpu': 'Intel Iris Xe', 'storage_type': 'SSD',
        'ram': 16, 'storage': '1T', 'screen': 17, 'status': 'new', 'touch': 'no'}}}


def allowed_values(field):
    return [o['value'] for o in options[field]]


def label_of(field, value):
    for o in options[field]:
        if o['value'] == value:
            return o['label']
    return value


def fail(field, message):
    raise HTTPException(status_code=422, detail=f'{field}: {message}')


def clean_text(field, value):
    text = str(value).lower().strip()
    if field == 'cpu':
        text = text.split('-')[0]                                   # i7-12700H -> i7
        text = re.sub(r'\b(' + '|'.join(CPU_WORDS) + r')\b', '', text)
        text = ' '.join(text.split())                               # 'core i7' -> 'i7'
    if field == 'gpu':
        integrated = re.search(r'\b(intel|iris|uhd|integrated|onboard|shared|no|none)\b', text)
        if integrated and not re.search(r'rtx|gtx', text):
            text = 'integrated'                                     # intel iris xe -> integrated
    return text


def match_option(field, text):
    allowed = allowed_values(field)
    if text in allowed:
        return text
    # an option written inside the text, e.g. 'nvidia geforce rtx 3050' -> 'rtx 3050' (longest first)
    for a in sorted(allowed, key=len, reverse=True):
        if re.search(r'\b' + re.escape(a) + r'\b', text):
            return a
    # small spelling mistakes, e.g. 'sd' -> 'ssd'
    close = difflib.get_close_matches(text, allowed, n=1, cutoff=0.6)
    if close:
        return close[0]
    fail(field, f"'{text}' not found, choose one of: {allowed}")


def clean_number(field, value):
    text = str(value).lower().replace(',', '.')                     # '15,6' -> '15.6'
    found = re.search(r'\d+(\.\d+)?', text)
    if not found:
        fail(field, f"'{value}' is not a number")
    return float(found.group())


def clean_storage(value):
    number = clean_number('storage', value)
    if isinstance(value, str) and 't' in value.lower():
        number = number * 1024                                      # 1T -> 1024 GB
    return number


def nearest(number, field):
    # the closest size that exists in the data (990 -> 1024, 17 -> 17.3)
    return min(allowed_values(field), key=lambda a: abs(a - number))


def clean_status(value):
    text = str(value).lower()
    if re.search(r'refurb|renew|second|\bused|\bold|\b(no|non|not|without|false|0)', text):
        return 0                                                    # refurbished / not new
    if re.search(r'new|yes|true|1', text):
        return 1
    fail('status', "use new / refurbished")


def clean_touch(value):
    text = str(value).lower()
    if re.search(r'\b(no|non|not|without|false|0)', text):
        return 0                                                    # no / not touch
    if re.search(r'touch|yes|true|1', text):
        return 1
    fail('touch', "use yes / no or touch / not touch")


@app.get('/options')
def get_options():
    # the frontend builds its dropdowns from this
    return options


@app.post('/predict')
def predict(specs: LaptopSpecs):
    data = specs.model_dump()
    row = {}
    adjusted = {}     # what we had to guess or round

    # text fields: lowercase + clean, then match one of the options
    for field in ['brand', 'cpu', 'gpu', 'storage_type']:
        text = clean_text(field, data[field])
        value = match_option(field, text)
        row[field] = value
        if value != text:
            adjusted[field] = f'{data[field]} -> {label_of(field, value)}'

    # number fields: take the number, then round it to the nearest size in the data
    numbers = {
        'ram': clean_number('ram', data['ram']),
        'storage': clean_storage(data['storage']),
        'screen': clean_number('screen', data['screen']),
    }
    for field, number in numbers.items():
        value = nearest(number, field)
        row[field] = value
        if value != number:
            adjusted[field] = f'{data[field]} -> {label_of(field, value)}'

    row['status'] = clean_status(data['status'])
    row['touch'] = clean_touch(data['touch'])

    used_specs = {field: label_of(field, value) for field, value in row.items()}
    row = {FIELD_TO_COLUMN[field]: value for field, value in row.items()}
    price = float(model.predict(pd.DataFrame([row]))[0])

    # find the laptop name that matches the chosen specs
    conditions = list(row.keys())

    while True:
        mask = pd.Series(True, index=lookup.index)
        for col in conditions:
            mask &= lookup[col] == row[col]
        candidates = lookup[mask]
        if len(candidates) > 0:
            break
        # no laptop found -> drop the next filter
        for col in RELAX_ORDER:
            if col in conditions:
                conditions.remove(col)
                break

    match = 'exact' if len(conditions) == len(row) else 'close'

    # of the matching laptops, take the one whose real price is closest to the predicted price
    best = (candidates['Final Price'] - price).abs().idxmin()
    name = candidates.loc[best, 'Name']

    return {
        'predicted_price': round(price, 2),
        'name': name,
        'match': match,             # exact = a laptop with the same specs exists, close = nearest one
        'used_specs': used_specs,   # the specs the model really used
        'adjusted': adjusted,       # inputs we had to round or guess
    }

