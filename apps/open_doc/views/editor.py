from typing import Any

from vela.core.router import Router
from vela.template_engine import mark_safe
from vela.template_engine.engine import render_template

from apps.open_doc.services.preferences_service import PROJECT_ROOT


def _render_partial(name: str, router: Router):
    """Render a local Vela template and mark only that framework output as trusted."""
    return mark_safe(
        render_template(
            str(PROJECT_ROOT / f"apps/open_doc/templates/{name}.html"),
            router=router,
        )
    )


def workspace_view(params: dict[str, Any]) -> str:
    """Renderiza a composição usando exclusivamente o template engine Vela."""
    router = params["router"]
    context = {
        name: _render_partial(name, router)
        for name in ("sidebar", "editor", "menus", "toolbar", "home")
    }
    return render_template(
        str(PROJECT_ROOT / "apps/open_doc/templates/base.html"),
        context=context,
        router=router,
    )


def register_routes(router: Router) -> None:
    """Conecta a tela à navegação e ao lifecycle do shell Vela."""
    router.add(
        "/",
        workspace_view,
        title="Escrita",
        name="open_doc",
        layout="blank",
        show_in_sidebar=False,
    )
