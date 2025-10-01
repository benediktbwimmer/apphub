import json
import subprocess
import tempfile

SNIPPET = """
from pydantic import BaseModel


class GreetingInput(BaseModel):
    name: str


class GreetingOutput(BaseModel):
    greeting: str


def build_greeting(payload: GreetingInput) -> GreetingOutput:
    return GreetingOutput(greeting=f'Hello {payload.name}!')
"""


def test_analyzer_extracts_schema():
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as fh:
        fh.write(SNIPPET)
        path = fh.name

    result = subprocess.run(
        ['python3', 'services/core/src/jobs/snippets/pythonSnippetAnalyzer.py', path],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload['ok'] is True
    assert payload['handlerName'] == 'build_greeting'
    assert payload['inputModel']['name'] == 'GreetingInput'
    assert payload['outputModel']['name'] == 'GreetingOutput'


if __name__ == '__main__':
    test_analyzer_extracts_schema()
    print('ok')
