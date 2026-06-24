"""Allow running 'python -m zhinengkefu' to start the service."""
from scripts.main import main
import sys

if __name__ == "__main__":
    sys.exit(main())
