from pathlib import Path

from django.db import migrations

SQL = (Path(__file__).resolve().parent.parent / "sql" / "platform_compat.sql").read_text()


class Migration(migrations.Migration):
    initial = True
    dependencies: list = []
    operations = [migrations.RunSQL(SQL, reverse_sql=migrations.RunSQL.noop)]
