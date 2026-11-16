from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/presentations', lambda params: workspace_view(params, 'presentations'), name='presentations', title='Apresentações', layout='blank', show_in_sidebar=False)
